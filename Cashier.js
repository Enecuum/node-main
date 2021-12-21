const Utils = require('./Utils');
const ContractMachine = require('./SmartContracts');
const Substate = require('./Substate').Substate;
const {ContractError} = require('./errors');

class Cashier {
    constructor(config, db){
        this.config = config;
        this.db = db;
        this.mrewards = BigInt(0);
        this.refrewards = BigInt(0);
        this.srewards = BigInt(0);
        this.krewards = BigInt(0);
    }
    eindex_entry(arr, type, id, hash, value) {
        if(this.config.indexer_mode !== 1)
            return;
        arr.push({type : type, id : id, hash : hash, value : value });
    }

    processTransfer(tx, substate){
        let token = substate.tokens.find(tok => ((tok.hash === tx.ticker)));
        if (token === undefined) {
            throw new ContractError("Token not found");
        }
        let token_enq = substate.tokens.find(tok => ((tok.hash === Utils.ENQ_TOKEN_NAME)));

        let token_fee = BigInt(Utils.calc_fee(token, tx.amount));
        let native_fee = BigInt(Utils.calc_fee(token_enq, 0));
        tx.amount = BigInt(tx.amount);
        if ((tx.amount - token_fee) >= BigInt(0)) {

            // Take amount from `from`
            substate.accounts_change(
                {
                    id : tx.from,
                    token : tx.ticker,
                    amount : BigInt(-1) * tx.amount
                }
            );

            // Take native fee amount from token owner
            substate.accounts_change(
                {
                    id : token.owner,
                    token : Utils.ENQ_TOKEN_NAME,
                    amount : BigInt(-1) * native_fee
                }
            );

            if(token.fee_type === 2){
                // Take token fee as native from `from`
                substate.accounts_change(
                    {
                        id : tx.from,
                        token : Utils.ENQ_TOKEN_NAME,
                        amount : BigInt(-1) * token.fee_value
                    }
                );
                // Give token fee as native to token owner
                substate.accounts_change(
                    {
                        id : token.owner,
                        token : Utils.ENQ_TOKEN_NAME,
                        amount : token.fee_value
                    }
                );
            }
            else{
                // Give token fee to token owner
                substate.accounts_change(
                    {
                        id : token.owner,
                        token : tx.ticker,
                        amount : token_fee
                    }
                );
            }

            // Give amount to `to`
            substate.accounts_change(
                {
                    id : tx.to,
                    token : tx.ticker,
                    amount : BigInt(tx.amount - token_fee)
                }
            );
        }
        else
            throw new ContractError("Negative ledger state");
    }

    status_entry(status, tx) {
        if(this.config.indexer_mode === 1)
            return {
                hash: tx.hash,
                mblocks_hash: tx.mblocks_hash,
                status: status,
                ticker : tx.ticker,
                amount : tx.amount,
                from : tx.from,
                to : tx.to
            };
        return {
            hash: tx.hash,
            mblocks_hash: tx.mblocks_hash,
            status: status
        };
    }
    async ledger_update_002(kblock, limit) {
        let hash = kblock.hash;
        let accounts = [];
        let statuses = [];
        let post_action = [];
        let contracts = {};
        let total_pos_stake = BigInt(0);
        let time = process.hrtime();
        let rewards = [];
        //console.debug(`cashier processing macroblock ${hash}`);
        console.trace(`cashier processing macroblock ${JSON.stringify(kblock)}`);

        let chunk = await this.db.get_new_microblocks(hash, limit);
        let CMachine = ContractMachine.getContractMachine(this.config.FORKS, kblock.n);
        let CFactory = new ContractMachine.ContractFactory(this.config);

        console.silly('cashier chunk = ', JSON.stringify(chunk));
        console.debug(`cashier is processing chunk ${hash} of ${chunk.mblocks.length} mblocks with ${chunk.txs ? chunk.txs.length : "NaN"} txs`);

        /**
         * No mblocs means that all mblocks in kblock were calculated, time to close kblock
         * or
         * empty kblock
         */
        if (chunk.mblocks.length === 0) {
            console.debug(`No more blocks in kblock ${hash}, terminating`);
            let mblocks = await this.db.get_included_microblocks(kblock.hash);
            let sblocks = await this.db.get_new_statblocks(hash);
            let mblock_tokens = [];
            let mblock_pubs = {};
            let tok_obj = {};
            let supply_change = {};
            let total_reward = BigInt(0);
            accounts.push(this.db.ORIGIN.publisher);
            accounts.push(kblock.publisher);
            accounts = accounts.concat(mblocks.map(m => m.publisher));
            accounts = accounts.concat(mblocks.map(m => m.referrer));

            // Add pos owners to sblocks and accounts array
            if (sblocks.length !== 0) {
                let poses = await this.db.get_pos_contract_all();
                for(let sb of sblocks){
                    let pos = poses.find(p => p.id === sb.publisher);
                    if(pos){
                        sb.pos_owner = pos.owner;
                        accounts.push(sb.pos_owner);
                    }
                }
            }
            /**
             * 1. Get all mblocks from database
             * 2. Get all involved tokens
             * 3. Get all token info - create tokens array with block rewards & refrewards
             * 4. Filter mblocks by only existing & minable tokens
             * 4. Add all token owners to accounts
             * 5. Build object :
             * 		{
             * 		 	"token_hash_1" : {
             *				block_reward : 15,
             *				ref_share : 1000,
             *				total_poa_stake : 0,
             *				total_poa_rew : 0,
             *				min_stake : 25,
             *				max_stake : 1000,
             *				referrer_stake : 1000
             * 		 	}
             * 		}
             * 6. Create object with pub stakes
             *
             */
            mblock_tokens = mblock_tokens.concat(mblocks.map(m => m.token));
            let tokens = await this.db.get_tokens_all(mblock_tokens);
            let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];

            accounts = accounts.concat(tokens.map(tok => tok.owner));
            accounts = accounts.filter((v, i, a) => a.indexOf(v) === i);
            accounts = accounts.filter(v => v !== null);

            accounts = await this.db.get_accounts_all(accounts);

            /**
             * mblocks & refrewards calculation
             */
            for(let tok of tokens){
                tok_obj[tok.hash] = tok;
                tok_obj[tok.hash].total_poa_stake = BigInt(0);
                if(tok.hash === Utils.ENQ_TOKEN_NAME){
                    tok_obj[tok.hash].total_poa_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.poa) / Utils.PERCENT_FORMAT_SIZE;
                    tok_obj[tok.hash].max_stake = BigInt(this.config.stake_limits.max_stake);
                }
                else{
                    // Check token emission.
                    if(tok.block_reward > (tok.max_supply - tok.total_supply)){
                        tok.block_reward = BigInt(0);
                        console.info(`${tok.ticker} token emission is over, setting mreward to 0`)
                    }
                    tok_obj[tok.hash].total_poa_reward = BigInt(tok.block_reward) * BigInt(Utils.PERCENT_FORMAT_SIZE) / (BigInt(Utils.PERCENT_FORMAT_SIZE) + BigInt(tok.ref_share));
                }
            }
            let total_pos_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.pos) / Utils.PERCENT_FORMAT_SIZE;

            let org = accounts.findIndex(a => ((a.id === this.db.ORIGIN.publisher) && (a.token === Utils.ENQ_TOKEN_NAME)));

            for(let i = 0; i < mblocks.length; i++){
                let block = mblocks[i];
                let pub = accounts.findIndex(a => ((a.id === block.publisher)  && (a.token === block.token)));
                mblock_pubs[block.hash] = {};
                if(block.token === Utils.ENQ_TOKEN_NAME){
                    let stake = BigInt(0);
                    if (pub > -1) {
                        stake = (accounts[pub].amount > stake) ? accounts[pub].amount : stake;
                        stake = (stake > tok_obj[block.token].max_stake) ? tok_obj[block.token].max_stake : stake;
                    }
                    tok_obj[block.token].total_poa_stake += BigInt(stake);
                    mblock_pubs[block.hash].stake = BigInt(stake);
                }
                else{
                    tok_obj[block.token].total_poa_stake += BigInt(accounts[pub].amount);
                    mblock_pubs[block.hash].stake = BigInt(accounts[pub].amount);
                }
            }

            for(let i = 0; i < mblocks.length; i++){
                let total_mblock_reward = BigInt(0);
                let m = mblocks[i];
                if(!supply_change.hasOwnProperty(m.token))
                    supply_change[m.token] = BigInt(0);
                let pub = accounts.findIndex(a => ((a.id === m.publisher)  && (a.token === m.token)));
                let owner = accounts.findIndex(a => ((a.id === tok_obj[m.token].owner)  && (a.token === m.token)));

                let stake = mblock_pubs[m.hash].stake;

                if (pub > -1 && tok_obj[m.token].total_poa_stake > BigInt(0)) {
                    m.reward = BigInt(stake) * tok_obj[m.token].total_poa_reward / tok_obj[m.token].total_poa_stake;
                    accounts[pub].amount = BigInt(accounts[pub].amount) + m.reward;
                    total_mblock_reward += m.reward;
                    this.mrewards += m.reward;
                    this.eindex_entry(rewards, 'im', accounts[pub].id, m.hash, m.reward);
                } else {
                    console.warn(`PoA miner with low-stake detected at mblock ${JSON.stringify(m)}`);
                    m.reward = BigInt(0);
                    total_mblock_reward += m.reward;
                    if(pub < 0){
                        accounts.push({id: m.publisher, amount: m.reward, token: m.token});
                        pub = accounts.findIndex(a => ((a.id === m.publisher)  && (a.token === m.token)));
                    }
                    this.mrewards += m.reward;
                }

                let ref = accounts.findIndex(a => ((a.id === m.referrer) && (a.token === m.token)));

                //let ref_reward = BigInt(m.reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref);

                let ref_reward = BigInt(m.reward) * BigInt(tok_obj[m.token].ref_share) / BigInt(Utils.PERCENT_FORMAT_SIZE);
                if (ref > -1) {
                    let real_ref;
                    if (accounts[ref].amount >= tok_obj[m.token].referrer_stake) {
                        real_ref = ref;
                    } else {
                        real_ref = owner;
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + ref_reward / BigInt(2);
                    accounts[real_ref].amount = BigInt(accounts[real_ref].amount) + ref_reward /  BigInt(2);
                    total_mblock_reward += ((ref_reward /  BigInt(2)) *  BigInt(2));
                    this.refrewards += ref_reward;
                    this.eindex_entry(rewards, 'iref', accounts[pub].id, m.hash, ref_reward / BigInt(2));
                    this.eindex_entry(rewards, 'iref', accounts[real_ref].id, m.hash, ref_reward / BigInt(2));
                } else {
                    accounts[owner].amount = BigInt(accounts[owner].amount) + ref_reward;
                    this.eindex_entry(rewards, 'iref', accounts[owner].id, m.hash, ref_reward);
                    total_mblock_reward += ref_reward;
                    this.refrewards += ref_reward;
                }

                if(m.token === Utils.ENQ_TOKEN_NAME){
                    total_reward += total_mblock_reward;
                }
                else{
                    // Token dust collecting
                    let mref = m.reward + ref_reward;
                    accounts[owner].amount = BigInt(accounts[owner].amount) + (mref - total_mblock_reward);
                    // In this cycle we change supply_change object only for minable tokens
                    // ENQ supply change will be made before block termination call
                    supply_change[m.token] += total_mblock_reward;
                }
            }

            // calc total poa stake

            //if(total_poa_stake > 0 && mblocks.length !== 0){
            // }
            // else {
            // 	// TODO: this code handle reward leakage on zero-stake mblock publisher (bad thing)
            // 	// TODO: this code handle reward leakage on empty kblock with no mblocks (bad thing)
            // 	if(kblock.n !== 0){
            // 		accounts[org].amount = BigInt(accounts[org].amount) + BigInt(total_poa_reward) + (BigInt(total_poa_reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref));
            // 		this.mrewards += total_poa_reward;
            // 		this.refrewards += (BigInt(total_poa_reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref));
            // 	}
            // }

            /**
             * Kblock reward
             */
            let total_pow_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.pow) / Utils.PERCENT_FORMAT_SIZE;
            kblock.reward = BigInt(total_pow_reward);
            let k_pub = accounts.findIndex(a => ((a.id === kblock.publisher)  && (a.token === Utils.ENQ_TOKEN_NAME)));
            if (k_pub > -1) {
                accounts[k_pub].amount = BigInt(accounts[k_pub].amount) + BigInt(kblock.reward);
                total_reward += BigInt(kblock.reward);
                this.krewards += kblock.reward;
            } else {
                accounts.push({id: kblock.publisher, amount: kblock.reward, token: Utils.ENQ_TOKEN_NAME});
                total_reward += BigInt(kblock.reward);
                this.krewards += kblock.reward;
            }
            this.eindex_entry(rewards, 'ik', kblock.publisher, kblock.hash, kblock.reward);
            /**
             * POS rewards
             *
             * - Total reward for all POS-contracts:
             * pos_reward = block_reward * pos_ratio
             *
             * - Total reward for single POS-contract:
             * contract_reward = pos_reward * contract_stake / total_pos_stake
             *
             * - Total reward splits between pos_owner and delegators
             * pos_owner_reward = fee * contract_reward
             * delegates_reward = contract_reward - owner_reward
             *
             * - Single delegator reward:
             * delegate_reward = delegate_stake * delegates_reward / contract_stake
             */
            let pos_info = await this.db.get_pos_info(sblocks.map(s => s.publisher));
            //Sum total pos stake
            sblocks = sblocks.filter(s => {
                let pub = pos_info.findIndex(a => a.pos_id === s.publisher);
                if (pub > -1){
                    total_pos_stake += BigInt(pos_info[pub].stake);
                    return true;
                }
                else
                    return false;
            });
            //Calc pos rewards
            if((total_pos_stake > 0) && (sblocks.length > 0)){
                let cont = new CMachine.Contract();
                for(let s of sblocks) {
                    let pub = accounts.findIndex(a => ((a.id === s.pos_owner) && (a.token === Utils.ENQ_TOKEN_NAME)));
                    let delegate = pos_info.findIndex(a => a.pos_id === s.publisher);
                    let contract_reward = total_pos_reward * BigInt(pos_info[delegate].stake) / total_pos_stake;
                    let pos_owner_reward = BigInt(pos_info[delegate].fee) * contract_reward / Utils.PERCENT_FORMAT_SIZE;
                    let delegates_reward = contract_reward - pos_owner_reward;
                    s.reward = contract_reward;
                    // calc for all delegators
                    let delegators = await this.db.get_pos_delegators(s.publisher);
                    for(let del of delegators){
                        // Add new reward to old for post_action
                        if(pos_info[delegate].stake > 0){
                            // TODO: possible reward leakage SET reward = ?
                            let del_reward = BigInt(del.amount) * delegates_reward / BigInt(pos_info[delegate].stake);
                            if(del_reward > BigInt(0)) {
                                total_reward += BigInt(del_reward);
                                let sql = cont.mysql.format(`(?, ?, ?)`,
                                    [del.pos_id, del.delegator, del_reward]);
                                post_action = post_action.concat([sql]);
                            }
                        }
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + pos_owner_reward;
                    total_reward += BigInt(pos_owner_reward);
                    this.eindex_entry(rewards,'iv', accounts[pub].id, s.hash, pos_owner_reward);
                    this.eindex_entry(rewards,'istat', s.publisher, s.hash, s.reward);
                    this.srewards += pos_owner_reward;
                    this.srewards += delegates_reward;
                }
            }
            else{
                if(kblock.n !== 0){
                    accounts[org].amount = BigInt(accounts[org].amount) + total_pos_reward;
                    this.srewards += total_pos_reward;
                }
            }
            /**
             * Fee distribution
             */

                // Now we can't define LPoS so we set ldr_share to 0
            let ldr_acc;
            let total_fee = BigInt(0);

            let kblock_tx_count = await this.db.get_kblock_txs_count(kblock.hash);
            let native_fee = BigInt(Utils.calc_fee(token_enq, 0));
            let kblock_fees = BigInt(kblock_tx_count) * native_fee;

            //accounts[org].amount = BigInt(accounts[org].amount) + BigInt(kblock_fees);
            let fee_shares = this.config.fee_shares;
            let pow_fee_share = kblock_fees * BigInt(fee_shares.pow_share) / Utils.PERCENT_FORMAT_SIZE;
            let org_fee_share = kblock_fees * BigInt(fee_shares.gen_share) / Utils.PERCENT_FORMAT_SIZE;
            let ldr_fee_share = kblock_fees * BigInt(fee_shares.ldr_share) / Utils.PERCENT_FORMAT_SIZE;
            let pos_fee_share = kblock_fees * BigInt(fee_shares.pos_share) / Utils.PERCENT_FORMAT_SIZE;

            if (k_pub > -1) {
                accounts[k_pub].amount = BigInt(accounts[k_pub].amount) + BigInt(pow_fee_share);
                this.eindex_entry(rewards, 'ifk', accounts[k_pub].id, kblock.hash, BigInt(pow_fee_share));
                total_fee += BigInt(pow_fee_share);
            } else
                org_fee_share += pow_fee_share;

            if (org > -1) {
                accounts[org].amount = BigInt(accounts[org].amount) + BigInt(org_fee_share);
                this.eindex_entry(rewards, 'ifg', accounts[org].id, kblock.hash, BigInt(org_fee_share));
                total_fee += BigInt(org_fee_share);
            }

            if((total_pos_stake > 0) && (sblocks.length > 0)){
                let cont = new CMachine.Contract();
                for(let s of sblocks) {
                    let pub = accounts.findIndex(a => ((a.id === s.pos_owner) && (a.token === Utils.ENQ_TOKEN_NAME)));
                    let delegate = pos_info.findIndex(a => a.pos_id === s.publisher);
                    let contract_fee_reward = pos_fee_share * BigInt(pos_info[delegate].stake) / total_pos_stake;
                    let pos_owner_fee_reward = BigInt(pos_info[delegate].fee) * contract_fee_reward / Utils.PERCENT_FORMAT_SIZE;
                    let delegates_fee_reward = contract_fee_reward - pos_owner_fee_reward;
                    // calc for all delegators
                    let delegators = await this.db.get_pos_delegators(s.publisher);
                    for (let del of delegators) {
                        // Add new reward to old for post_action
                        if (pos_info[delegate].stake > 0) {
                            let del_reward = BigInt(del.amount) * delegates_fee_reward / BigInt(pos_info[delegate].stake);
                            if(del_reward > BigInt(0)){
                                total_fee += BigInt(del_reward);
                                let sql = cont.mysql.format(`(?, ?, ?)`,
                                    [del.pos_id, del.delegator, del_reward]);
                                post_action = post_action.concat([sql]);
                            }
                        }
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + pos_owner_fee_reward;
                    this.eindex_entry(rewards, 'iv', accounts[pub].id, kblock.hash, BigInt(pos_owner_fee_reward));
                    total_fee += BigInt(pos_owner_fee_reward);
                }
            }
            else {
                accounts[org].amount = BigInt(accounts[org].amount) + pos_fee_share;
                total_fee += BigInt(pos_fee_share);
            }

            let dust_block = BigInt(token_enq.block_reward) - BigInt(total_reward);
            let dust_fees = BigInt(kblock_fees) - BigInt(total_fee);
            accounts[org].amount += dust_block + dust_fees;
            this.eindex_entry(rewards, 'idust', accounts[org].id, kblock.hash, BigInt(dust_block + dust_fees));

            supply_change[Utils.ENQ_TOKEN_NAME] = token_enq.block_reward;

            let group_update_delegates = `DROP TEMPORARY TABLE IF EXISTS tmp_delegates;
										  CREATE TEMPORARY TABLE  tmp_delegates (
										  tmp_pos_id VARCHAR(64),
										  tmp_delegator VARCHAR(66),
										  tmp_reward BIGINT(20),
										  PRIMARY KEY (tmp_pos_id, tmp_delegator));
										  
										  INSERT INTO tmp_delegates (tmp_pos_id, tmp_delegator, tmp_reward) VALUES
										  ${post_action.join(',')}
										  ON DUPLICATE KEY UPDATE tmp_reward = tmp_reward + VALUES(tmp_reward);
										  
										  UPDATE delegates RIGHT JOIN tmp_delegates ON pos_id = tmp_pos_id AND delegator = tmp_delegator SET reward = reward + tmp_reward;
										  DROP TEMPORARY TABLE IF EXISTS tmp_delegates`;

            time = process.hrtime(time);
            console.debug(`cashier_timing: kblock termination ${hash} prepared in`, Utils.format_time(time));

            time = process.hrtime();

            await this.db.terminate_ledger_kblock(accounts, kblock, mblocks, sblocks, [group_update_delegates], supply_change, rewards);

            time = process.hrtime(time);
            console.debug(`cashier_timing: kblock termination ${hash} saved in`, Utils.format_time(time));

            console.info(`---------------------------------`);

            // console.log(this.mrewards, this.refrewards, this.srewards, this.krewards);
            // console.log(`Total:   ${this.mrewards + this.refrewards + this.srewards + this.krewards}`)
            // console.log(`Formule: ${BigInt(token_enq.block_reward * (kblock.n)) }`)
            let ledger = BigInt((await this.db.get_total_supply()).amount);
            let formula = BigInt(this.config.ORIGIN.reward) + (BigInt(token_enq.block_reward) * BigInt(kblock.n + 1));
            console.log(`n: ${kblock.n}`);
            console.log(`Ledger:  ${ledger}`);
            console.log(`Formula: ${formula}`);
            console.log(`Dust:    ${dust_block + dust_fees}`);
            console.log(`Diff:    ${formula - ledger} \r\n`);
            //if(formula - ledger !== BigInt(0))
            //    throw new Error(`There is a diff after block calculation, cashier stopped`);
            return;
        }

        let substate = new Substate(this.config, this.db);

        substate.accounts.push(this.db.ORIGIN.publisher);

        if (chunk.mblocks.length !== 0) {
            substate.accounts = substate.accounts.concat(chunk.txs.map(tx => tx.from));
            substate.accounts = substate.accounts.concat(chunk.txs.map(tx => tx.to));
            substate.accounts.push(kblock.publisher);
        }

        // TODO: костыль. Вынести валидацию в explorer. Ужадить из кассира после вайпа истории
        let filtered_tickers = chunk.txs.map(function (tx) {
            let hash_regexp = /^[0-9a-fA-F]{64}$/i;
            if (hash_regexp.test(tx.ticker))
                return tx.ticker;
        });
        let tokens = await this.db.get_tokens_all(filtered_tickers);
        let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];
        substate.accounts = substate.accounts.concat(tokens.map(token => token.owner));

        substate.tokens.push(Utils.ENQ_TOKEN_NAME);
        substate.tokens = substate.tokens.concat(filtered_tickers);

        let duplicates = await this.db.get_duplicates(chunk.txs.map(tx => tx.hash));
        console.silly(`duplicates = ${JSON.stringify(duplicates)}`);
        console.debug(`duplicates.length = ${duplicates.length}`);

        // Remove duplicates
        for(let i = 0; i < chunk.txs.length; i++) {
            let tx = chunk.txs[i];
            if (duplicates.some(d => d.hash === tx.hash) || (i !== chunk.txs.findIndex(t => t.hash === tx.hash))) {
                statuses.push(this.status_entry(Utils.TX_STATUS.DUPLICATE, tx));
                console.debug(`duplicate tx ${JSON.stringify(tx)}`);
                // remove this tx from array
                chunk.txs.splice(i, 1);
                i--;
            }
        }
        // Parse all contracts to get involved accounts
        // Also get all involved POS contracts and delegators
        // Also reject all TXs with incorrect contracts
        for(let i = 0; i < chunk.txs.length; i++){
            let tx = chunk.txs[i];

            if (CFactory.isContract(tx.data)) {
                try {
                    // Clone tx object so we can pass amount without fee
                    let _tx = Object.assign({}, tx);
                    _tx.amount -= token_enq.fee_value;
                    // Create contract to get it's params. Without execution
                    contracts[tx.hash] = await CFactory.create(_tx, this.db);
                    // Pass contract's params to substate to add data
                    substate.fillByContract(contracts[tx.hash], tx);

                } catch (err) {
                    //if(err instanceof ContractError)
                    // TODO: logger-style errors
                    console.log(err);
                    statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));
                    console.debug(`rejected tx ${JSON.stringify(tx)}. Reason: ${err}`);
                    // remove this tx from array
                    chunk.txs.splice(i, 1);
                    i--;
                }
            }
        }

        console.trace(`cashier ${substate.accounts.length} accounts: ${Utils.JSON_stringify(substate.accounts)}`);
        console.silly(`accounts = ${JSON.stringify(substate.accounts)}`);

        await substate.loadState();
        let substate_copy = new Substate(this.config, this.db);
        for(let i = 0; i < chunk.txs.length; i++){
            let tx = chunk.txs[i];

            substate_copy.setState(substate);
            tx.amount = BigInt(tx.amount);

            try {
                this.processTransfer(tx, substate_copy);
                // Check if tx has contract
                let contract = contracts[tx.hash] || null;
                if (contract) {
                    let res = await contract.execute(tx, substate_copy, kblock, this.config);
                    // add eindex entry for claims
                    if(contract.type === 'pos_reward')
                        this.eindex_entry(rewards, 'ic', substate_copy.claims[tx.hash].delegator, tx.hash, substate_copy.claims[tx.hash].reward);
                    if(res.hasOwnProperty("dex_swap"))
                        this.eindex_entry(rewards, 'iswapout', tx.from, tx.hash, res.dex_swap.out);
                    if(res.hasOwnProperty("farm_reward"))
                        this.eindex_entry(rewards, 'ifrew', tx.from, tx.hash, res.farm_reward);

                    if(res.hasOwnProperty("pool_create_lt"))
                        this.eindex_entry(rewards, 'ipcreatelt', tx.from, tx.hash, res.pool_create_lt);
                    if(res.hasOwnProperty("liq_add_lt"))
                        this.eindex_entry(rewards, 'iliqaddlt', tx.from, tx.hash, res.liq_add_lt);
                    if(res.hasOwnProperty("liq_remove")){
                        this.eindex_entry(rewards, 'iliqrmv1', tx.from, tx.hash, res.liq_remove.liq_remove1);
                        this.eindex_entry(rewards, 'iliqrmv2', tx.from, tx.hash, res.liq_remove.liq_remove2);
                    }
                    if(res.hasOwnProperty("farm_close_reward"))
                        this.eindex_entry(rewards, 'ifcloserew', tx.from, tx.hash, res.farm_close_reward);
                    if(res.hasOwnProperty("farm_decrease_reward"))
                        this.eindex_entry(rewards, 'ifdecrew', tx.from, tx.hash, res.farm_decrease_reward);
                }
                statuses.push(this.status_entry(Utils.TX_STATUS.CONFIRMED, tx));
                console.silly(`approved tx `, Utils.JSON_stringify(tx));
                substate.setState(substate_copy);
            }
            catch(err) {
                statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));
                console.debug(`rejected tx ${JSON.stringify(tx)}. Reason: ${err}`);
            }
        }

        time = process.hrtime(time);
        console.debug(`cashier_timing: mblocks chunk ${hash} prepared in`, Utils.format_time(time));

        let tokens_counts = {};
        if(this.config.indexer_mode === 1){
            for(let st of statuses){
                if ((st.status === Utils.TX_STATUS.REJECTED) || (st.status === Utils.TX_STATUS.CONFIRMED)) {
                    this.eindex_entry(rewards, 'iin', st.to, st.hash, st.amount);
                    this.eindex_entry(rewards, 'iout', st.from, st.hash, st.amount);
                }
                if (st.status === Utils.TX_STATUS.CONFIRMED) {
                    if(tokens_counts[st.ticker] === undefined)
                        tokens_counts[st.ticker] = 0;
                    tokens_counts[st.ticker]++;
                }
            }
        }
        //return;
        time = process.hrtime();

        await this.db.process_ledger_mblocks_002(statuses, chunk.mblocks, rewards, kblock, tokens_counts, substate);

        time = process.hrtime(time);
        console.debug(`cashier_timing: mblocks chunk ${hash} saved in`, Utils.format_time(time));
    }
    async ledger_update_000(kblock, limit) {
        let hash = kblock.hash;
        let accounts = [];
        let statuses = [];
        let post_action = [];
        let tickers = [];
        let token_changes = {};
        let contracts = {};
        let delegation_ledger = {};
        let transfer_ledger = {};
        let block_fees = BigInt(0);
        let total_pos_stake = BigInt(0);
        let time = process.hrtime();
        let rewards = [];
        //console.debug(`cashier processing macroblock ${hash}`);
        console.trace(`cashier processing macroblock ${JSON.stringify(kblock)}`);

        let chunk = await this.db.get_new_microblocks(hash, limit);
        let CMachine = ContractMachine.getContractMachine(this.config.FORKS, kblock.n);
        let CFactory = new ContractMachine.ContractFactory(this.config);

        console.silly('cashier chunk = ', JSON.stringify(chunk));
        console.debug(`cashier is processing chunk ${hash} of ${chunk.mblocks.length} mblocks with ${chunk.txs ? chunk.txs.length : "NaN"} txs`);

        /**
         * No mblocs means that all mblocks in kblock were calculated, time to close kblock
         * or
         * empty kblock
         */
        if (chunk.mblocks.length === 0) {
            console.debug(`No more blocks in kblock ${hash}, terminating`);
            let mblocks = await this.db.get_included_microblocks(kblock.hash);
            let sblocks = await this.db.get_new_statblocks(hash);
            let mblock_tokens = [];
            let mblock_pubs = {};
            let tok_obj = {};
            let supply_change = {};
            let total_reward = BigInt(0);
            accounts.push(this.db.ORIGIN.publisher);
            accounts.push(kblock.publisher);
            accounts = accounts.concat(mblocks.map(m => m.publisher));
            accounts = accounts.concat(mblocks.map(m => m.referrer));

            // Add pos owners to sblocks and accounts array
            if (sblocks.length !== 0) {
                let poses = await this.db.get_pos_contract_all();
                for(let sb of sblocks){
                    let pos = poses.find(p => p.id === sb.publisher);
                    if(pos){
                        sb.pos_owner = pos.owner;
                        accounts.push(sb.pos_owner);
                    }
                }
            }
            /**
             * 1. Get all mblocks from database
             * 2. Get all involved tokens
             * 3. Get all token info - create tokens array with block rewards & refrewards
             * 4. Filter mblocks by only existing & minable tokens
             * 4. Add all token owners to accounts
             * 5. Build object :
             * 		{
             * 		 	"token_hash_1" : {
             *				block_reward : 15,
             *				ref_share : 1000,
             *				total_poa_stake : 0,
             *				total_poa_rew : 0,
             *				min_stake : 25,
             *				max_stake : 1000,
             *				referrer_stake : 1000
             * 		 	}
             * 		}
             * 6. Create object with pub stakes
             *
             */
            mblock_tokens = mblock_tokens.concat(mblocks.map(m => m.token));
            let tokens = await this.db.get_tokens_all(mblock_tokens);
            let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];

            accounts = accounts.concat(tokens.map(tok => tok.owner));
            accounts = accounts.filter((v, i, a) => a.indexOf(v) === i);
            accounts = accounts.filter(v => v !== null);

            accounts = await this.db.get_accounts_all(accounts);

            /**
             * mblocks & refrewards calculation
             */
            for(let tok of tokens){
                tok_obj[tok.hash] = tok;
                tok_obj[tok.hash].total_poa_stake = BigInt(0);
                if(tok.hash === Utils.ENQ_TOKEN_NAME){
                    tok_obj[tok.hash].total_poa_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.poa) / Utils.PERCENT_FORMAT_SIZE;
                    tok_obj[tok.hash].max_stake = BigInt(this.config.stake_limits.max_stake);
                }
                else{
                    // Check token emission.
                    if(tok.block_reward > (tok.max_supply - tok.total_supply)){
                        tok.block_reward = BigInt(0);
                        console.info(`${tok.ticker} token emission is over, setting mreward to 0`)
                    }
                    tok_obj[tok.hash].total_poa_reward = BigInt(tok.block_reward) * BigInt(Utils.PERCENT_FORMAT_SIZE) / (BigInt(Utils.PERCENT_FORMAT_SIZE) + BigInt(tok.ref_share));
                }
            }
            let total_pos_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.pos) / Utils.PERCENT_FORMAT_SIZE;

            let org = accounts.findIndex(a => ((a.id === this.db.ORIGIN.publisher) && (a.token === Utils.ENQ_TOKEN_NAME)));

            for(let i = 0; i < mblocks.length; i++){
                let block = mblocks[i];
                let pub = accounts.findIndex(a => ((a.id === block.publisher)  && (a.token === block.token)));
                mblock_pubs[block.hash] = {};
                if(block.token === Utils.ENQ_TOKEN_NAME){
                    let stake = BigInt(0);
                    if (pub > -1) {
                        stake = (accounts[pub].amount > stake) ? accounts[pub].amount : stake;
                        stake = (stake > tok_obj[block.token].max_stake) ? tok_obj[block.token].max_stake : stake;
                    }
                    tok_obj[block.token].total_poa_stake += BigInt(stake);
                    mblock_pubs[block.hash].stake = BigInt(stake);
                }
                else{
                    tok_obj[block.token].total_poa_stake += BigInt(accounts[pub].amount);
                    mblock_pubs[block.hash].stake = BigInt(accounts[pub].amount);
                }
            }

            for(let i = 0; i < mblocks.length; i++){
                let total_mblock_reward = BigInt(0);
                let m = mblocks[i];
                if(!supply_change.hasOwnProperty(m.token))
                    supply_change[m.token] = BigInt(0);
                let pub = accounts.findIndex(a => ((a.id === m.publisher)  && (a.token === m.token)));
                let owner = accounts.findIndex(a => ((a.id === tok_obj[m.token].owner)  && (a.token === m.token)));

                let stake = mblock_pubs[m.hash].stake;

                if (pub > -1 && tok_obj[m.token].total_poa_stake > BigInt(0)) {
                    m.reward = BigInt(stake) * tok_obj[m.token].total_poa_reward / tok_obj[m.token].total_poa_stake;
                    accounts[pub].amount = BigInt(accounts[pub].amount) + m.reward;
                    total_mblock_reward += m.reward;
                    this.mrewards += m.reward;
                    this.eindex_entry(rewards, 'im', accounts[pub].id, m.hash, m.reward);
                } else {
                    console.warn(`PoA miner with low-stake detected at mblock ${JSON.stringify(m)}`);
                    m.reward = BigInt(0);
                    total_mblock_reward += m.reward;
                    if(pub < 0){
                        accounts.push({id: m.publisher, amount: m.reward, token: m.token});
                        pub = accounts.findIndex(a => ((a.id === m.publisher)  && (a.token === m.token)));
                    }
                    this.mrewards += m.reward;
                }

                let ref = accounts.findIndex(a => ((a.id === m.referrer) && (a.token === m.token)));

                //let ref_reward = BigInt(m.reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref);

                let ref_reward = BigInt(m.reward) * BigInt(tok_obj[m.token].ref_share) / BigInt(Utils.PERCENT_FORMAT_SIZE);
                if (ref > -1) {
                    let real_ref;
                    if (accounts[ref].amount >= tok_obj[m.token].referrer_stake) {
                        real_ref = ref;
                    } else {
                        real_ref = owner;
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + ref_reward / BigInt(2);
                    accounts[real_ref].amount = BigInt(accounts[real_ref].amount) + ref_reward /  BigInt(2);
                    total_mblock_reward += ((ref_reward /  BigInt(2)) *  BigInt(2));
                    this.refrewards += ref_reward;
                    this.eindex_entry(rewards, 'iref', accounts[pub].id, m.hash, ref_reward / BigInt(2));
                    this.eindex_entry(rewards, 'iref', accounts[real_ref].id, m.hash, ref_reward / BigInt(2));
                } else {
                    accounts[owner].amount = BigInt(accounts[owner].amount) + ref_reward;
                    this.eindex_entry(rewards, 'iref', accounts[owner].id, m.hash, ref_reward);
                    total_mblock_reward += ref_reward;
                    this.refrewards += ref_reward;
                }

                if(m.token === Utils.ENQ_TOKEN_NAME){
                    total_reward += total_mblock_reward;
                }
                else{
                    // Token dust collecting
                    let mref = m.reward + ref_reward;
                    accounts[owner].amount = BigInt(accounts[owner].amount) + (mref - total_mblock_reward);
                    // In this cycle we change supply_change object only for minable tokens
                    // ENQ supply change will be made before block termination call
                    supply_change[m.token] += total_mblock_reward;
                }
            }

            // calc total poa stake

            //if(total_poa_stake > 0 && mblocks.length !== 0){
            // }
            // else {
            // 	// TODO: this code handle reward leakage on zero-stake mblock publisher (bad thing)
            // 	// TODO: this code handle reward leakage on empty kblock with no mblocks (bad thing)
            // 	if(kblock.n !== 0){
            // 		accounts[org].amount = BigInt(accounts[org].amount) + BigInt(total_poa_reward) + (BigInt(total_poa_reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref));
            // 		this.mrewards += total_poa_reward;
            // 		this.refrewards += (BigInt(total_poa_reward) / BigInt(this.config.reward_ratio.poa) * BigInt(this.config.reward_ratio.ref));
            // 	}
            // }

            /**
             * Kblock reward
             */
            let total_pow_reward = BigInt(token_enq.block_reward) * BigInt(this.config.reward_ratio.pow) / Utils.PERCENT_FORMAT_SIZE;
            kblock.reward = BigInt(total_pow_reward);
            let k_pub = accounts.findIndex(a => ((a.id === kblock.publisher)  && (a.token === Utils.ENQ_TOKEN_NAME)));
            if (k_pub > -1) {
                accounts[k_pub].amount = BigInt(accounts[k_pub].amount) + BigInt(kblock.reward);
                total_reward += BigInt(kblock.reward);
                this.krewards += kblock.reward;
            } else {
                accounts.push({id: kblock.publisher, amount: kblock.reward, token: Utils.ENQ_TOKEN_NAME});
                total_reward += BigInt(kblock.reward);
                this.krewards += kblock.reward;
            }
            this.eindex_entry(rewards, 'ik', kblock.publisher, kblock.hash, kblock.reward);
            /**
             * POS rewards
             *
             * - Total reward for all POS-contracts:
             * pos_reward = block_reward * pos_ratio
             *
             * - Total reward for single POS-contract:
             * contract_reward = pos_reward * contract_stake / total_pos_stake
             *
             * - Total reward splits between pos_owner and delegators
             * pos_owner_reward = fee * contract_reward
             * delegates_reward = contract_reward - owner_reward
             *
             * - Single delegator reward:
             * delegate_reward = delegate_stake * delegates_reward / contract_stake
             */
            let pos_info = await this.db.get_pos_info(sblocks.map(s => s.publisher));
            //Sum total pos stake
            sblocks = sblocks.filter(s => {
                let pub = pos_info.findIndex(a => a.pos_id === s.publisher);
                if (pub > -1){
                    total_pos_stake += BigInt(pos_info[pub].stake);
                    return true;
                }
                else
                    return false;
            });
            //Calc pos rewards
            if((total_pos_stake > 0) && (sblocks.length > 0)){
                let cont = new CMachine.Contract();
                for(let s of sblocks) {
                    let pub = accounts.findIndex(a => ((a.id === s.pos_owner) && (a.token === Utils.ENQ_TOKEN_NAME)));
                    let delegate = pos_info.findIndex(a => a.pos_id === s.publisher);
                    let contract_reward = total_pos_reward * BigInt(pos_info[delegate].stake) / total_pos_stake;
                    let pos_owner_reward = BigInt(pos_info[delegate].fee) * contract_reward / Utils.PERCENT_FORMAT_SIZE;
                    let delegates_reward = contract_reward - pos_owner_reward;
                    s.reward = contract_reward;
                    // calc for all delegators
                    let delegators = await this.db.get_pos_delegators(s.publisher);
                    for(let del of delegators){
                        // Add new reward to old for post_action
                        if(pos_info[delegate].stake > 0){
                            // TODO: possible reward leakage SET reward = ?
                            let del_reward = BigInt(del.amount) * delegates_reward / BigInt(pos_info[delegate].stake);
                            if(del_reward > BigInt(0)) {
                                total_reward += BigInt(del_reward);
                                let sql = cont.mysql.format(`(?, ?, ?)`,
                                    [del.pos_id, del.delegator, del_reward]);
                                post_action = post_action.concat([sql]);
                            }
                        }
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + pos_owner_reward;
                    total_reward += BigInt(pos_owner_reward);
                    this.eindex_entry(rewards,'iv', accounts[pub].id, s.hash, pos_owner_reward);
                    this.eindex_entry(rewards, 'istat', s.publisher, s.hash, s.reward);
                    this.srewards += pos_owner_reward;
                    this.srewards += delegates_reward;
                }
            }
            else{
                if(kblock.n !== 0){
                    accounts[org].amount = BigInt(accounts[org].amount) + total_pos_reward;
                    this.srewards += total_pos_reward;
                }
            }
            /**
             * Fee distribution
             */

                // Now we can't define LPoS so we set ldr_share to 0
            let ldr_acc;
            let total_fee = BigInt(0);

            let kblock_tx_count = await this.db.get_kblock_txs_count(kblock.hash);
            let native_fee = BigInt(Utils.calc_fee(token_enq, 0));
            let kblock_fees = BigInt(kblock_tx_count) * native_fee;

            //accounts[org].amount = BigInt(accounts[org].amount) + BigInt(kblock_fees);
            let fee_shares = this.config.fee_shares;
            let pow_fee_share = kblock_fees * BigInt(fee_shares.pow_share) / Utils.PERCENT_FORMAT_SIZE;
            let org_fee_share = kblock_fees * BigInt(fee_shares.gen_share) / Utils.PERCENT_FORMAT_SIZE;
            let ldr_fee_share = kblock_fees * BigInt(fee_shares.ldr_share) / Utils.PERCENT_FORMAT_SIZE;
            let pos_fee_share = kblock_fees * BigInt(fee_shares.pos_share) / Utils.PERCENT_FORMAT_SIZE;

            if (k_pub > -1) {
                accounts[k_pub].amount = BigInt(accounts[k_pub].amount) + BigInt(pow_fee_share);
                this.eindex_entry(rewards, 'ifk', accounts[k_pub].id, kblock.hash, BigInt(pow_fee_share));
                total_fee += BigInt(pow_fee_share);
            } else
                org_fee_share += pow_fee_share;

            if (org > -1) {
                accounts[org].amount = BigInt(accounts[org].amount) + BigInt(org_fee_share);
                this.eindex_entry(rewards, 'ifg', accounts[org].id, kblock.hash, BigInt(org_fee_share));
                total_fee += BigInt(org_fee_share);
            }

            if((total_pos_stake > 0) && (sblocks.length > 0)){
                let cont = new CMachine.Contract();
                for(let s of sblocks) {
                    let pub = accounts.findIndex(a => ((a.id === s.pos_owner) && (a.token === Utils.ENQ_TOKEN_NAME)));
                    let delegate = pos_info.findIndex(a => a.pos_id === s.publisher);
                    let contract_fee_reward = pos_fee_share * BigInt(pos_info[delegate].stake) / total_pos_stake;
                    let pos_owner_fee_reward = BigInt(pos_info[delegate].fee) * contract_fee_reward / Utils.PERCENT_FORMAT_SIZE;
                    let delegates_fee_reward = contract_fee_reward - pos_owner_fee_reward;
                    // calc for all delegators
                    let delegators = await this.db.get_pos_delegators(s.publisher);
                    for (let del of delegators) {
                        // Add new reward to old for post_action
                        if (pos_info[delegate].stake > 0) {
                            let del_reward = BigInt(del.amount) * delegates_fee_reward / BigInt(pos_info[delegate].stake);
                            if(del_reward > BigInt(0)){
                                total_fee += BigInt(del_reward);
                                let sql = cont.mysql.format(`(?, ?, ?)`,
                                    [del.pos_id, del.delegator, del_reward]);
                                post_action = post_action.concat([sql]);
                            }
                        }
                    }
                    accounts[pub].amount = BigInt(accounts[pub].amount) + pos_owner_fee_reward;
                    this.eindex_entry(rewards, 'iv', accounts[pub].id, kblock.hash, BigInt(pos_owner_fee_reward));
                    total_fee += BigInt(pos_owner_fee_reward);
                }
            }
            else {
                accounts[org].amount = BigInt(accounts[org].amount) + pos_fee_share;
                total_fee += BigInt(pos_fee_share);
            }

            let dust_block = BigInt(token_enq.block_reward) - BigInt(total_reward);
            let dust_fees = BigInt(kblock_fees) - BigInt(total_fee);
            accounts[org].amount += dust_block + dust_fees;
            this.eindex_entry(rewards, 'idust', accounts[org].id, kblock.hash, BigInt(dust_block + dust_fees));

            supply_change[Utils.ENQ_TOKEN_NAME] = token_enq.block_reward;

            let group_update_delegates = `DROP TEMPORARY TABLE IF EXISTS tmp_delegates;
										  CREATE TEMPORARY TABLE  tmp_delegates (
										  tmp_pos_id VARCHAR(64),
										  tmp_delegator VARCHAR(66),
										  tmp_reward BIGINT(20),
										  PRIMARY KEY (tmp_pos_id, tmp_delegator));
										  
										  INSERT INTO tmp_delegates (tmp_pos_id, tmp_delegator, tmp_reward) VALUES
										  ${post_action.join(',')}
										  ON DUPLICATE KEY UPDATE tmp_reward = tmp_reward + VALUES(tmp_reward);
										  
										  UPDATE delegates RIGHT JOIN tmp_delegates ON pos_id = tmp_pos_id AND delegator = tmp_delegator SET reward = reward + tmp_reward;
										  DROP TEMPORARY TABLE IF EXISTS tmp_delegates`;

            time = process.hrtime(time);
            console.debug(`cashier_timing: kblock termination ${hash} prepared in`, Utils.format_time(time));

            time = process.hrtime();

            await this.db.terminate_ledger_kblock(accounts, kblock, mblocks, sblocks, [group_update_delegates], supply_change, rewards);

            time = process.hrtime(time);
            console.debug(`cashier_timing: kblock termination ${hash} saved in`, Utils.format_time(time));

            console.info(`---------------------------------`);

            // console.log(this.mrewards, this.refrewards, this.srewards, this.krewards);
            // console.log(`Total:   ${this.mrewards + this.refrewards + this.srewards + this.krewards}`)
            // console.log(`Formule: ${BigInt(token_enq.block_reward * (kblock.n)) }`)
            let ledger = BigInt((await this.db.get_total_supply()).amount);
            let formula = BigInt(this.config.ORIGIN.reward) + (BigInt(token_enq.block_reward) * BigInt(kblock.n + 1));
            console.log(`n: ${kblock.n}`);
            console.log(`Ledger:  ${ledger}`);
            console.log(`Formula: ${formula}`);
            console.log(`Dust:    ${dust_block + dust_fees}`);
            console.log(`Diff:    ${formula - ledger} \r\n`);
            if(formula - ledger !== BigInt(0))
                throw new Error(`There is a diff after block calculation, cashier stopped`);
            return;
        }

        accounts.push(this.db.ORIGIN.publisher);

        if (chunk.mblocks.length !== 0) {
            accounts = accounts.concat(chunk.txs.map(tx => tx.from));
            accounts = accounts.concat(chunk.txs.map(tx => tx.to));
            accounts.push(kblock.publisher);
        }

        let filtered_tickers = chunk.txs.map(function (tx) {
            let hash_regexp = /^[0-9a-fA-F]{64}$/i;
            if (hash_regexp.test(tx.ticker))
                return tx.ticker;
        });
        let tokens = await this.db.get_tokens_all(filtered_tickers);
        let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];
        accounts = accounts.concat(tokens.map(token => token.owner));

        let duplicates = await this.db.get_duplicates(chunk.txs.map(tx => tx.hash));
        console.silly(`duplicates = ${JSON.stringify(duplicates)}`);
        console.debug(`duplicates.length = ${duplicates.length}`);

        // Parse all contracts to get involved accounts
        // Also get all involved POS contracts and delegators
        // Also reject all TXs with incorrect contracts
        for(let i = 0; i < chunk.txs.length; i++){
            let tx = chunk.txs[i];
            if (duplicates.some(d => d.hash === tx.hash) || (i !== chunk.txs.findIndex(t => t.hash === tx.hash))) {
                statuses.push(this.status_entry(Utils.TX_STATUS.DUPLICATE, tx));
                console.debug(`duplicate tx ${JSON.stringify(tx)}`);
                // remove this tx from array
                chunk.txs.splice(i, 1);
                i--;
                continue;
            }
            if (CFactory.isContract(tx.data)) {
                try {
                    // Clone tx object so we can pass amount without fee
                    let _tx = Object.assign({}, tx);
                    _tx.amount -= token_enq.fee_value;
                    contracts[tx.hash] = await CFactory.processData(_tx, this.db, kblock);
                    // Add involved addresses to the rest
                    for (let acc of contracts[tx.hash].amount_changes) {
                        accounts.push(acc.id);
                    }
                    // Build delegation ledger
                    // Object be like :
                    // {
                    // 		"pos1" : {
                    // 			"addr1" : {
                    // 				delegated: 0,
                    // 				undelegated: 0
                    // 			}
                    // 			"addr2" : {
                    // 				delegated: 0,
                    //				undelegated: 0
                    // 			}
                    // 		},
                    // 		"pos2" : {
                    // 			"addr1" : {
                    // 				delegated: 0,
                    // 				undelegated: 0
                    // 			}
                    // 		}
                    // }
                    for (let el of contracts[tx.hash].pos_changes) {
                        if (!delegation_ledger.hasOwnProperty(el.pos_id)) {
                            delegation_ledger[el.pos_id] = {}
                        }
                        if (!delegation_ledger[el.pos_id].hasOwnProperty(el.delegator)) {
                            delegation_ledger[el.pos_id][el.delegator] = {
                                delegated: BigInt(0),
                                undelegated: BigInt(0),
                                reward: BigInt(0)
                            }
                        }
                        if (el.transfer) {
                            if (transfer_ledger[el.transfer] === true) {
                                throw new ContractError("Transfer has already been executed.");
                            }
                            transfer_ledger[el.transfer] = true;
                        }
                    }
                } catch (err) {
                    //if(err instanceof ContractError)
                    // TODO: logger-style errors
                    console.log(err);
                    statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));
                    console.silly(`rejected tx ${JSON.stringify(tx)}. Reason: ${err}`);
                    // remove this tx from array
                    chunk.txs.splice(i, 1);
                    i--;
                }
            }
        }
        // Fill delegation_ledger with delegated amounts/ We can't get undelegated by address
        for (let pos_id in delegation_ledger) {
            let ids = Object.keys(delegation_ledger[pos_id]);
            let delegates = await this.db.get_pos_delegates(pos_id, ids);
            for (let del of delegates) {
                delegation_ledger[pos_id][del.delegator].delegated = BigInt(del.amount);
                delegation_ledger[pos_id][del.delegator].reward = BigInt(del.reward);
            }
        }
        accounts = accounts.filter((v, i, a) => a.indexOf(v) === i);
        accounts = accounts.filter(v => v !== null);

        console.trace(`cashier ${accounts.length} accounts: ${Utils.JSON_stringify(accounts)}`);

        accounts = await this.db.get_accounts_all(accounts);

        console.silly(`accounts = ${JSON.stringify(accounts)}`);

        for(let [i, tx] of chunk.txs.entries()) {
            let from = accounts.findIndex(acc => ((acc.id === tx.from) && (acc.token === tx.ticker)));
            let to = accounts.findIndex(acc => ((acc.id === tx.to) && (acc.token === tx.ticker)));

            let token = tokens.find(tok => ((tok.hash === tx.ticker)));
            if (token === undefined) {
                statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));
                console.silly(`rejected tx `, JSON.stringify(tx));
                continue;
            }
            let tok_owner = accounts.findIndex(acc => ((acc.id === token.owner) && (acc.token === token.hash)));
            let tok_owner_enq = accounts.findIndex(acc => ((acc.id === token.owner) && (acc.token === Utils.ENQ_TOKEN_NAME)));

            let token_fee = BigInt(Utils.calc_fee(token, tx.amount));
            let native_fee = BigInt(Utils.calc_fee(token_enq, 0));
            tx.amount = BigInt(tx.amount);
            if ((from > -1)
                && (accounts[from].amount >= tx.amount)
                && (accounts[tok_owner_enq].amount >= native_fee)
                && ((tx.amount - token_fee) >= BigInt(0))) {

                // Clone accounts
                let accounts_copy = accounts.map(a => Object.assign({}, a));
                let dl_copy = {};
                accounts_copy[from].amount = BigInt(accounts_copy[from].amount) - tx.amount;
                accounts_copy[tok_owner].amount = BigInt(accounts_copy[tok_owner].amount) + token_fee;

                accounts_copy[tok_owner_enq].amount = BigInt(accounts_copy[tok_owner_enq].amount) - native_fee;

                if (to > -1) {
                    accounts_copy[to].amount = BigInt(accounts_copy[to].amount) + BigInt(tx.amount - token_fee);
                } else {
                    accounts_copy.push({id: tx.to, amount: BigInt(tx.amount - token_fee), token: tx.ticker});
                }
                // Check if tx has contract
                let contract = contracts[tx.hash] || null;
                if (contract) {
                    for (let el of contract.amount_changes) {
                        let changed = accounts_copy.findIndex(acc => ((acc.id === el.id) && (acc.token === el.token_hash)));
                        if (changed > -1)
                            accounts_copy[changed].amount = BigInt(accounts_copy[changed].amount) + BigInt(el.amount_change);
                        else
                            accounts_copy.push({
                                id: el.id,
                                amount: BigInt(el.amount_change),
                                token: el.token_hash
                            });
                    }
                    // Clone delegation_ledger
                    dl_copy = Object.assign({}, delegation_ledger);

                    for (let el of contract.pos_changes) {
                        dl_copy[el.pos_id][el.delegator].delegated += BigInt(el.delegated);
                        dl_copy[el.pos_id][el.delegator].undelegated += BigInt(el.undelegated);
                        dl_copy[el.pos_id][el.delegator].reward += BigInt(el.reward);
                    }
                    // Check ticker unique
                    if (contract.token_info) {
                        if (contract.token_info.ticker) {
                            if (tickers.includes(contract.token_info.ticker)) {
                                statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));
                                console.silly(`rejected tx `, Utils.JSON_stringify(tx));
                                continue;
                            }
                            tickers.push(contract.token_info.ticker);
                        }
                        if (contract.token_info.supply_change) {
                            if (token_changes[contract.token_info.hash] === undefined) {
                                token_changes[contract.token_info.hash] = {
                                    db_supply: BigInt(0),
                                    supply_change: BigInt(0)
                                };
                            }
                            token_changes[contract.token_info.hash].db_supply = contract.token_info.db_supply;
                            token_changes[contract.token_info.hash].supply_change += contract.token_info.supply_change;
                            if ((BigInt(token_changes[contract.token_info.hash].db_supply) + BigInt(token_changes[contract.token_info.hash].supply_change)) < BigInt(0)) {
                                statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));

                                console.debug(`rejected tx `, Utils.JSON_stringify(tx));
                                continue;
                            }
                        }
                    }
                }

                // Check copy for negative amounts.
                if (accounts_copy.some(d => d.amount < 0)) {
                    statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));

                    console.silly(`rejected tx `, Utils.JSON_stringify(tx));
                }
                // Check dl_copy for negative delegates & undelegates.
                else if (Object.keys(dl_copy).some(function (val) {
                    for (let id in dl_copy[val]) {
                        if (dl_copy[val][id].delegated < 0 || dl_copy[val][id].undelegated < 0 || dl_copy[val][id].reward < 0) {
                            return true;
                        }
                    }
                })) {
                    statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));

                    console.silly(`rejected tx `, Utils.JSON_stringify(tx));
                } else {
                    // Add tx fee
                    block_fees += native_fee;
                    // Replace old accounts
                    accounts = accounts_copy.map(a => Object.assign({}, a));
                    // Add post_action
                    if (contract) {
                        // Replace old delegation_ledger
                        delegation_ledger = Object.assign({}, dl_copy);
                        for(let rec of contract.pos_changes){
                            if(rec.reward < BigInt(0))
                                this.eindex_entry(rewards, 'ic', rec.delegator, tx.hash, BigInt(-1) * rec.reward);
                        }
                        post_action = post_action.concat(contracts[tx.hash].post_action);
                    }
                    statuses.push(this.status_entry(Utils.TX_STATUS.CONFIRMED, tx));

                    console.silly(`approved tx `, Utils.JSON_stringify(tx));
                }
            } else {
                statuses.push(this.status_entry(Utils.TX_STATUS.REJECTED, tx));

                console.debug(`rejected tx `, Utils.JSON_stringify(tx));
            }
        }

        time = process.hrtime(time);
        console.debug(`cashier_timing: mblocks chunk ${hash} prepared in`, Utils.format_time(time));

        time = process.hrtime();
        // TODO: if cashier mode is verbose
        let tokens_counts = {};
        if(this.config.indexer_mode === 1){
            for(let st of statuses){
                if ((st.status === Utils.TX_STATUS.REJECTED) || (st.status === Utils.TX_STATUS.CONFIRMED)) {
                    this.eindex_entry(rewards, 'iin', st.to, st.hash, st.amount);
                    this.eindex_entry(rewards, 'iout', st.from, st.hash, st.amount);
                }
                if (st.status === Utils.TX_STATUS.CONFIRMED) {
                    if(tokens_counts[st.ticker] === undefined)
                        tokens_counts[st.ticker] = 0;
                    tokens_counts[st.ticker]++;
                }
            }
        }
        await this.db.process_ledger_mblocks_000(accounts, statuses, chunk.mblocks, post_action, rewards, kblock, tokens_counts);

        time = process.hrtime(time);
        console.debug(`cashier_timing: mblocks chunk ${hash} saved in`, Utils.format_time(time));
    }

    async start(run_once = false){
        await this.cashier(run_once);
    }
    async cashier(run_once) {
        try {
            let cur_hash = await this.db.get_cashier_pointer();
            if (cur_hash === null) {
                cur_hash = this.db.ORIGIN.hash;
            }
            let next = await this.db.get_next_block(cur_hash);
            let block = (await this.db.get_kblock(cur_hash))[0];
            if (block === undefined)
                block = await this.db.peek_tail();
            if (block === undefined)
                return;
            // if(block.n === 41000)
            // 	return;
            // Create snapshot of current block if needed
            if ((block.n) % this.config.snapshot_interval === 0) {
                let snapshot_hash = await this.db.get_snapshot_hash(cur_hash);
                if (!snapshot_hash) {
                    let snapshot = await this.db.create_snapshot(cur_hash); //cur_hash);
                    let hash = Utils.hash_snapshot(snapshot);
                    console.info(`Snapshot hash of ${block.n} kblock: ${hash}`);
                    await this.db.put_snapshot(snapshot, hash);
                }
            }
            if (next) {
                console.trace(`cashier cur_block: ${cur_hash} , next_block: ${next.hash}`);
                if(block.n >= this.config.FORKS.fork_block_002){
                    await this.ledger_update_002(block, this.config.cashier_chunk_size);
                }
                else
                    await this.ledger_update_000(block, this.config.cashier_chunk_size);
            } else {
                console.trace(`Cashier block ${cur_hash} not closed yet`)
            }
            //let put_time = process.hrtime(time);
            //console.debug(`chunk ${cur_hash} calculated in`, Utils.format_time(put_time));
        } catch (e) {
            console.error(e);
        } finally {
            if (run_once === false)
                setTimeout(this.cashier.bind(this, run_once), this.config.cashier_interval_ms);
        }
    }
}

module.exports.Cashier = Cashier;