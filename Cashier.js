const Utils = require('./Utils');
const ContractMachine = require('./SmartContracts');
const {ContractError} = require('./errors');

class Substate {
    constructor(config, db){
        this.config = config;
        this.db = db;
        this.accounts = [];
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
        this.delegation_ledger = {};
        this.undelegates = {};
        this.tokens = [];
        this.poses = [];
        this.transfers = [];
        this.pools = [];
        // For remove_liquidity contract
        this.lt_hashes = [];
        this.claims = {};
    }
    async loadState(){
        this.accounts = this.accounts.filter((v, i, a) => a.indexOf(v) === i);
        this.accounts = this.accounts.filter(v => v !== null);
        this.accounts = await this.db.get_accounts_all(this.accounts);

        this.pools = await this.db.dex_get_pools(this.pools);
        let more_pools = await this.db.dex_get_pools_by_lt(this.lt_hashes);

        if(more_pools.length > 0)
            this.pools = this.pools.concat(more_pools);
        this.pools = this.pools.filter((v, i, a) => a.indexOf(v) === i);
        this.pools = this.pools.filter(v => v !== null);
        this.lt_hashes = this.pools.map(h => h.token_hash);
        if(this.lt_hashes.length > 0)
            this.tokens = this.tokens.concat(this.lt_hashes);
        this.tokens = this.tokens.filter((v, i, a) => a.indexOf(v) === i);
        this.tokens = this.tokens.filter(v => v !== null);
        this.tokens = this.tokens.map(function (hash) {
            let hash_regexp = /^[0-9a-fA-F]{64}$/i;
            if (hash_regexp.test(hash))
                return hash;
        });
        this.tokens = await this.db.get_tokens_all(this.tokens);

        //this.poses = this.poses.filter((v, i, a) => a.indexOf(v) === i);
        //this.poses = this.poses.filter(v => v !== null);
        this.poses = await this.db.get_pos_names();

        for (let pos_id in this.delegation_ledger) {
            let ids = Object.keys(this.delegation_ledger[pos_id]);
            let delegates = await this.db.get_pos_delegates(pos_id, ids);
            if(delegates){

                for (let del of delegates) {
                    this.delegation_ledger[pos_id][del.delegator].delegated = BigInt(del.amount);
                    this.delegation_ledger[pos_id][del.delegator].reward = BigInt(del.reward);
                }
            }
            for (let del in this.delegation_ledger[pos_id]) {
                if(!this.delegation_ledger[pos_id][del].hasOwnProperty('delegated'))
                    delete this.delegation_ledger[pos_id][del]
            }
        }

        for (let und in this.undelegates) {
            let row = (await this.db.get_pos_undelegates(und))[0];
            if(row)
                this.undelegates[und] = row;
            else
                delete this.undelegates[und]
        }
    }
    setState(state){
        this.delegation_ledger = JSON.parse(JSON.stringify(state.delegation_ledger));
        for(let pos in state.delegation_ledger){
            for(let del in state.delegation_ledger[pos]){
                this.delegation_ledger[pos][del] = Object.assign({}, state.delegation_ledger[pos][del]);
            }
        }
        for(let und in state.undelegates){
            this.undelegates[und] = Object.assign({}, state.undelegates[und]);
        }

        this.undelegates = Object.assign({}, state.undelegates);
        this.tokens = state.tokens.map(a => Object.assign({}, a));
        this.poses = state.poses.map(a => Object.assign({}, a));
        this.transfers = state.transfers.map(a => Object.assign({}, a));
        this.pools = state.pools.map(a => Object.assign({}, a));
        this.accounts = state.accounts.map(a => Object.assign({}, a));
    }
    fillByContract(contract, tx){
        let type = contract.type;
        switch(type) {
            case "create_token" : {
                // token hash as tx hash
                this.tokens.push(tx.hash);
            }
                break;
            case "create_pos" : {
            }
                break;
            case "delegate" : {
                // create empty structure for [pos_id][delegator]
                if (!this.delegation_ledger.hasOwnProperty(contract.data.parameters.pos_id)) {
                    this.delegation_ledger[contract.data.parameters.pos_id] = {}
                }
                if (!this.delegation_ledger[contract.data.parameters.pos_id].hasOwnProperty(tx.from)) {
                    this.delegation_ledger[contract.data.parameters.pos_id][tx.from] = {}
                }
            }
                break;
            case "undelegate" : {
                // create empty structure for [pos_id][delegator]
                if (!this.delegation_ledger.hasOwnProperty(contract.data.parameters.pos_id)) {
                    this.delegation_ledger[contract.data.parameters.pos_id] = {}
                }
                if (!this.delegation_ledger[contract.data.parameters.pos_id].hasOwnProperty(tx.from)) {
                    this.delegation_ledger[contract.data.parameters.pos_id][tx.from] = {}
                }
            }
                break;
            case "transfer" : {
                // create empty undelegate structure for TX
                if (!this.undelegates.hasOwnProperty(contract.data.parameters.undelegate_id)) {
                    this.undelegates[contract.data.parameters.undelegate_id] = {}
                }
            }
                break;
            case "pos_reward" : {
                // create empty structure for [pos_id][delegator]
                if (!this.delegation_ledger.hasOwnProperty(contract.data.parameters.pos_id)) {
                    this.delegation_ledger[contract.data.parameters.pos_id] = {}
                }
                if (!this.delegation_ledger[contract.data.parameters.pos_id].hasOwnProperty(tx.from)) {
                    this.delegation_ledger[contract.data.parameters.pos_id][tx.from] = {}
                }
            }
                break;
            case "mint" : {
                // token_hash info
                this.tokens.push(contract.data.parameters.token_hash);
            }
                break;
            case "burn" : {
                // token_hash info
                this.tokens.push(contract.data.parameters.token_hash);
            }
                break;
            case "create_pool" : {
                // asset_1 token info
                // asset_2 token info
                // 1_2 pool info
                this.tokens.push(contract.data.parameters.asset_1);
                this.tokens.push(contract.data.parameters.asset_2);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_1, contract.data.parameters.asset_2).pair_id);
            }
                break;
            case "add_liquidity" : {
                // asset_1 token info
                // asset_2 token info
                // 1_2 pool info
                this.tokens.push(contract.data.parameters.asset_1);
                this.tokens.push(contract.data.parameters.asset_2);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_1, contract.data.parameters.asset_2).pair_id);
            }
                break;
            case "remove_liquidity" :
                // l_token token info
                // pool of l_token info
                this.tokens.push(contract.data.parameters.hash);
                this.lt_hashes.push(contract.data.parameters.hash);
                break;
            case "swap" :
                this.tokens.push(contract.data.parameters.asset_in);
                this.tokens.push(contract.data.parameters.asset_out);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_in, contract.data.parameters.asset_out).pair_id);
                break;
            default : return false;
        }
    }
    validateState(){
        // check all ledger for non-negative values
        if (this.accounts.some(d => d.amount < 0)) {
            return false;
        }
        if (this.tokens.some(d => d.total_supply < 0)) {
            return false;
        }
        if (Object.keys(this.delegation_ledger).some(function (val) {
            for (let id in this.delegation_ledger[val]) {
                if (this.delegation_ledger[val][id].delegated < 0 || this.delegation_ledger[val][id].undelegated < 0 || this.delegation_ledger[val][id].reward < 0) {
                    return true;
                }
            }})){
            return false;
        }
        return true;
    }
    get_tickers_all(){
        return this.tokens;
    }
    get_pos_names(){
        return this.poses;
    }
    get_pos_contract_all(){
        return this.poses;
    }
    get_pos_delegates(pos_id, delegator){
        return this.delegation_ledger[pos_id][delegator];
    }
    get_pos_undelegates(undelegate_id){
        return this.undelegates[undelegate_id];
    }
    get_transfer_lock(){
        return this.db.app_config.transfer_lock;
    }
    get_token_info(hash){
        if(!hash)
            return null;
        return this.tokens.find(a => a.hash === hash);
    }
    dex_check_pool_exist(pair_id){
        let index = this.pools.findIndex(pool => (pool.pair_id === pair_id));
        return (index > -1);
    }
    get_dex_pool_info_by_token(lt_hash){
        if(!lt_hash)
            return null;
        return this.pools.find(a => a.token_hash === lt_hash);
    }
    get_balance(id, token){
        let index = this.accounts.findIndex(acc => ((acc.id === id) && (acc.token === token)));
        return (index > -1) ? this.accounts[index] : ({amount : 0, decimals : 10});
    }
    dex_get_pool_info(pair_id){
        if(!pair_id)
            return null;
        return this.pools.find(a => a.pair_id === pair_id);
    }
    pools_add(changes){
        if(this.pools.find(a => a.hash === changes.pair_id))
            throw new ContractError(`Pool ${changes.pair_id} already exist`);
        changes.changed = true;
        this.pools.push(changes);
    }
    tokens_add(changes){
        if(this.tokens.find(a => a.hash === changes.hash))
            throw new ContractError(`Token ${changes.hash} already exist`);
        changes.changed = true;
        this.tokens.push(changes);
    }
    poses_add(changes){
        if(this.poses.find(a => a.name === changes.name))
            throw new ContractError(`Pos ${changes.name} already exist`);
        changes.changed = true;
        this.poses.push(changes);
    }
    delegators_add(changes){
        if (!this.delegation_ledger.hasOwnProperty(changes.pos_id)) {
            this.delegation_ledger[changes.pos_id] = {}
        }
        if (!this.delegation_ledger[changes.pos_id].hasOwnProperty(changes.delegator)) {
            this.delegation_ledger[changes.pos_id][changes.delegator] = {
                delegated: BigInt(0),
                reward: BigInt(0)
            }
        }
        if(this.delegation_ledger[changes.pos_id][changes.delegator].delegated + changes.amount < BigInt(0)){
            throw new ContractError(`Negative delegation_ledger state`);
        }
        this.delegation_ledger[changes.pos_id][changes.delegator].delegated += changes.amount;
        this.delegation_ledger[changes.pos_id][changes.delegator].changed = true;
    }
    pools_change(changes){
        let pool_idx = this.pools.findIndex(a => a.pair_id === changes.pair_id);
        if(pool_idx > -1){
            if(this.pools[pool_idx].volume_1 + changes.volume_1 < BigInt(0))
                throw new ContractError(`Negative pools state`);
            if(this.pools[pool_idx].volume_2 + changes.volume_2 < BigInt(0))
                throw new ContractError(`Negative pools state`);
            this.pools[pool_idx].volume_1 += changes.volume_1;
            this.pools[pool_idx].volume_2 += changes.volume_2;
            this.pools[pool_idx].changed = true;
        }
    }
    delegators_change(changes){
        if(this.delegation_ledger[changes.pos_id][changes.delegator].delegated + changes.amount < BigInt(0)){
            throw new ContractError(`Negative delegation_ledger state`);
        }
        this.delegation_ledger[changes.pos_id][changes.delegator].delegated += changes.amount;
        this.delegation_ledger[changes.pos_id][changes.delegator].changed = true;
    }
    tokens_change(changes){
        let tok_idx = this.tokens.findIndex(a => a.hash === changes.hash);
        if(tok_idx > -1){
            if(this.tokens[tok_idx].total_supply + changes.total_supply < BigInt(0))
                throw new ContractError(`Negative tokens state`);
            this.tokens[tok_idx].total_supply += changes.total_supply;
            this.tokens[tok_idx].changed = true;
        }
    }
    accounts_change(changes){
        let acc_idx = this.accounts.findIndex(acc => ((acc.id === changes.id) && (acc.token === changes.token)));
        changes.changed = true;
        if(acc_idx > -1){
            if((BigInt(this.accounts[acc_idx].amount) + BigInt(changes.amount)) < BigInt(0))
                throw new ContractError(`Negative ledger state`);
            this.accounts[acc_idx].amount = BigInt(this.accounts[acc_idx].amount) + BigInt(changes.amount);
        }
        else{
            if(BigInt(changes.amount) < BigInt(0))
                throw new ContractError(`Negative ledger state`);
            this.accounts.push(changes);
        }
    }
    undelegates_add(changes){
        if(this.undelegates.hasOwnProperty(changes.id))
            throw new ContractError(`Undelegate ${changes.id} already exist`);
        changes.changed = true;
        this.undelegates[changes.id] = changes;
    }
    undelegates_change(changes){
        changes.changed = true;
        this.undelegates[changes.id] = changes;
    }
    claim_reward(changes){
        this.delegation_ledger[changes.pos_id][changes.delegator].reward = BigInt(0);
        this.delegation_ledger[changes.pos_id][changes.delegator].changed = true;
        // needs for indexing
        this.claims[changes.hash] = {
            delegator : changes.delegator,
            reward : changes.amount
        }
    }
}

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
                    await contract.execute(tx, substate_copy, kblock);
                    // add eindex entry for claims
                    if(contract.type === 'pos_reward')
                        this.eindex_entry(rewards, 'ic', substate_copy.claims[tx.hash].delegator, tx.hash, substate_copy.claims[tx.hash].reward);
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
        }
        if (run_once === false)
            setTimeout(this.cashier.bind(this, run_once), this.config.cashier_interval_ms);
    }
}

module.exports.Cashier = Cashier;
module.exports.Substate = Substate;