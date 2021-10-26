const {ContractError} = require('./errors');
const Utils = require('./Utils');
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
        this.farms = [];
        this.farmers = [];
    }
    async loadState(){
        this.accounts = this.accounts.filter((v, i, a) => a.indexOf(v) === i);
        this.accounts = this.accounts.filter(v => v !== null);
        this.accounts = await this.db.get_accounts_all(this.accounts);

        // TODO: optimized selection
        // this.pools = await this.db.dex_get_pools(this.pools);
        // let more_pools = await this.db.dex_get_pools_by_lt(this.lt_hashes);
        // if(more_pools.length > 0)
        //     this.pools = this.pools.concat(more_pools);
        // this.pools = this.pools.filter((v, i, a) => a.indexOf(v) === i);
        // this.pools = this.pools.filter(v => v !== null);
        this.pools = await this.db.dex_get_pools_all();

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
        // TODO: optimized selection
        // this.farms = this.farms.filter((v, i, a) => a.indexOf(v) === i);
        // this.farms = this.farms.filter(v => v !== null);
        // this.farms = await this.db.get_farms(this.farms);
        this.farms = await this.db.get_farms_all();
        // TODO farmers
        this.farmers = this.farmers.filter((v, i, a) => a.indexOf(v) === i);
        this.farmers = this.farmers.filter(v => v !== null);
        this.farmers = await this.db.get_farmers_by_farmer(this.farmers);
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
        this.farms = state.farms.map(a => Object.assign({}, a));
        this.farmers = state.farmers.map(a => Object.assign({}, a));
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
            case "pool_create" : {
                // asset_1 token info
                // asset_2 token info
                // 1_2 pool info
                this.tokens.push(contract.data.parameters.asset_1);
                this.tokens.push(contract.data.parameters.asset_2);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_1, contract.data.parameters.asset_2).pair_id);
            }
                break;
            case "pool_add_liquidity" : {
                // asset_1 token info
                // asset_2 token info
                // 1_2 pool info
                this.tokens.push(contract.data.parameters.asset_1);
                this.tokens.push(contract.data.parameters.asset_2);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_1, contract.data.parameters.asset_2).pair_id);
            }
                break;
            case "pool_remove_liquidity" :
                // l_token token info
                // pool of l_token info
                this.tokens.push(contract.data.parameters.lt);
                this.lt_hashes.push(contract.data.parameters.lt);
                break;
            case "pool_swap" :
                this.accounts.push(Utils.DEX_COMMANDER_ADDRESS);
                this.accounts.push(Utils.DEX_BURN_ADDRESS);
                this.tokens.push(contract.data.parameters.asset_in);
                this.tokens.push(contract.data.parameters.asset_out);
                this.pools.push(Utils.getPairId(contract.data.parameters.asset_in, contract.data.parameters.asset_out).pair_id);
                break;
            case "farm_create" : {
                // stake_token token info
                // reward_token token info
                this.farms.push(tx.hash);
                this.tokens.push(contract.data.parameters.stake_token);
                this.tokens.push(contract.data.parameters.reward_token);
            }
                break;
            case "farm_increase_stake" : {
                this.farms.push(contract.data.parameters.farm_id);
                this.farmers.push(tx.from);
            }
                break;
            case "farm_decrease_stake" : {
                this.farms.push(contract.data.parameters.farm_id);
                this.farmers.push(tx.from);
            }
                break;
            case "farm_close_stake" : {
                this.farms.push(contract.data.parameters.farm_id);
                this.farmers.push(tx.from);
            }
                break;
            case "farm_get_reward" : {
                this.farms.push(contract.data.parameters.farm_id);
                this.farmers.push(tx.from);
            }
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
    get_farm(farm_id){
        if(!farm_id)
            return null;
        return this.farms.find(a => a.farm_id === farm_id);
    }
    get_farmer(farm_id, farmer_id){
        if(!farm_id || !farmer_id)
            return null;
        return this.farmers.find(a => ((a.farm_id === farm_id) && (a.farmer_id === farmer_id)));
    }
    pools_add(changes){
        if(this.pools.find(a => a.hash === changes.pair_id))
            throw new ContractError(`Pool ${changes.pair_id} already exist`);
        changes.changed = true;
        this.pools.push(changes);
    }
    farms_add(changes){
        if(this.farms.find(a => a.farm_id === changes.farm_id))
            throw new ContractError(`Farm ${changes.farm_id} already exist`);
        changes.changed = true;
        this.farms.push(changes);
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
    farms_change(changes){
        let farm_idx = this.farms.findIndex(a => a.farm_id === changes.farm_id);
        if(farm_idx > -1){
           if(changes.hasOwnProperty("emission")){
                if(this.farms[farm_idx].emission + changes.emission < BigInt(0))
                    throw new ContractError(`Negative farms state`);
                this.farms[farm_idx].emission += changes.emission;
                this.farms[farm_idx].changed = true;
            }
            if(changes.hasOwnProperty("level")){
                if(changes.level < BigInt(0))
                    throw new ContractError(`Incorrect level`);
                this.farms[farm_idx].level = changes.level;
                this.farms[farm_idx].changed = true;
            }
            if(changes.hasOwnProperty("total_stake")){
                if(this.farms[farm_idx].total_stake + changes.total_stake < BigInt(0))
                    throw new ContractError(`Negative farms state`);
                this.farms[farm_idx].total_stake += changes.total_stake;
                this.farms[farm_idx].changed = true;
            }
            if(changes.hasOwnProperty("last_block")){
                if(changes.last_block < this.farms[farm_idx].last_block)
                    throw new ContractError(`Incorrect last_block`);
                this.farms[farm_idx].last_block = changes.last_block;
                this.farms[farm_idx].changed = true;
            }
        }
    }
    farmers_change(changes){
        let farmer_idx = this.farmers.findIndex(a => ((a.farm_id === changes.farm_id) && (a.farmer_id === changes.farmer_id)));
        if(farmer_idx > -1){
            if(changes.hasOwnProperty("stake")){
                if(this.farmers[farmer_idx].stake + changes.stake < BigInt(0))
                    throw new ContractError(`Negative farmers state`);
                this.farmers[farmer_idx].stake += changes.stake;
                if(this.farmers[farmer_idx].stake <= BigInt(0))
                    this.farmers[farmer_idx].delete = true;
                this.farmers[farmer_idx].changed = true;
            }
            if(changes.hasOwnProperty("level")){
                // TODO: can new_level be less than old_level?
                if(this.farmers[farmer_idx].level > changes.level)
                    throw new ContractError(`Negative farmers state`);
                this.farmers[farmer_idx].level = changes.level;
                this.farmers[farmer_idx].changed = true;
            }
        }
        else{
            changes.changed = true;
            this.farmers.push(changes);
        }
    }
    farmers_delete(changes){
        let farmer_idx = this.farmers.findIndex(a => ((a.farm_id === changes.farm_id) && (a.farmer_id === changes.farmer_id)));
        if(farmer_idx > -1) {
            this.farmers[farmer_idx].delete = true;
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

module.exports.Substate = Substate;