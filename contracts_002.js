/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * contracts_002.js
 * Enecuum smart contracts logic
 *
 * Working with actual chain
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');
const {ContractError} = require('./errors');
const ContractMachine = require('./SmartContracts');
const ContractParser = require('./contractParser').ContractParser;
//let MAX_SUPPLY = BigInt('18446744073709551615');
let MAX_SUPPLY_LIMIT = BigInt('18446744073709551615');
let LEVEL_DECIMALS =   BigInt('10000000000000000000');
let MAX_DECIMALS = BigInt(10);
let ENQ_INTEGER_COIN = BigInt(10000000000);

class Contract{
    constructor() {
        this._mysql = require('mysql');
        this.type = null;
    }
    get mysql(){
        return this._mysql;
    }
}
class TokenCreateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        let params = this.data.parameters;

        let paramsModel = ["fee_type", "fee_value", "ticker", "decimals", "total_supply", "name"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let letters_regexp = /^[A-Z]{1,6}$/g;
        if(!letters_regexp.test(params.ticker))
            throw new ContractError("Incorrect ticker format");
        if(params.name.length > 40)
            throw new ContractError("token format is too long");

        let bigintModel = ["fee_value", "fee_min", "decimals", "total_supply", "max_supply", "block_reward", "min_stake", "ref_share", "referrer_stake"];
        if (!bigintModel.every(key => ((typeof params[key] === 'undefined') || (typeof params[key] === 'bigint')))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.decimals < 0 || params.decimals > MAX_DECIMALS){
            throw new ContractError("Incorrect total_supply value");
        }
        if(params.minable){
            if(params.minable !== 0 && params.minable !== 1)
                throw new ContractError("Incorrect minable flag, expect 0 or 1");
            if(params.minable === 1 && params.reissuable !== 0)
                throw new ContractError("Minable token can't be reissuable");
            if(params.minable === 1){
                // Check structure
                let miningModel = ["max_supply", "block_reward", "min_stake", "ref_share", "referrer_stake"];
                if (miningModel.some(key => params[key] === undefined)){
                    throw new ContractError("Incorrect param structure for minable token");
                }
                // Check 0 < x < MAX_SUPPLY_LIMIT
                let amountsModel = ["max_supply", "block_reward", "total_supply", "referrer_stake"];
                for(let key of amountsModel){
                    if (params[key] < 0 || params[key] > MAX_SUPPLY_LIMIT){
                        throw new ContractError(`${key} if out of 0...MAX_SUPPLY_LIMIT range`);
                    }
                }
                /**
                 *        max_supply = tsup + block_rew * x years
                 *  0 [__total_supply___|____to_be_mined__________] MAX_SUPPLY_LIMIT
                 *
                 *  0 <= tsup <= max_supply
                 *  0 <= to_be_mined <= max_supply
                 */

                // if(params.max_supply > MAX_SUPPLY_LIMIT){
                //     throw new ContractError("max_supply can't be bigger than MAX_SUPPLY_LIMIT");
                // }
                if(params.max_supply <= 0 || params.max_supply < params.total_supply){
                    throw new ContractError("Incorrect supply params");
                }
                if(params.block_reward > (params.max_supply - params.total_supply)){
                    throw new ContractError("Incorrect block_reward param");
                }
                if(params.ref_share > Utils.PERCENT_FORMAT_SIZE || params.ref_share < 0){
                    throw new ContractError("Incorrect ref_share param");
                }
                if(params.referrer_stake > params.total_supply || params.referrer_stake < 0){
                    throw new ContractError("Incorrect referrer_stake param");
                }
                if(params.min_stake > params.total_supply || params.min_stake <= 0){
                    throw new ContractError("Incorrect min_stake param");
                }
            }
        }

        if(params.reissuable){
            if(params.reissuable !== 0 && params.reissuable !== 1)
                throw new ContractError("Incorrect reissuable flag, expect 0 or 1");
        }
        if(params.total_supply < 0 || params.total_supply > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect total_supply value");
        }

        switch (params.fee_type) {
            case 0 : {
                if(params.fee_value < 0 || params.fee_value > MAX_SUPPLY_LIMIT)
                    throw new ContractError("Incorrect fee params");
                break;
            }
            case 1 : {
                if(params.fee_value < 0 || params.fee_value > Utils.PERCENT_FORMAT_SIZE)
                    throw new ContractError("Incorrect fee params");
                if(params.fee_min === undefined){
                    throw new ContractError("Missing fee_min for fee_type = 1");
                }
                if(params.fee_min < 0 || params.fee_min > MAX_SUPPLY_LIMIT){
                    throw new ContractError("Incorrect fee_min value");
                }
                break;
            }
            case 2 : {
                if(params.fee_value < 0 || params.fee_value > MAX_SUPPLY_LIMIT)
                    throw new ContractError("Incorrect fee params");
                break;
            }
            default : {
                throw new ContractError("Incorrect fee params");
            }
        }
        return true;
    }
    async execute(tx, substate) {
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        let tok_data = {
            hash : tx.hash,
            owner : tx.from,
            fee_type : params.fee_type,
            fee_value : params.fee_value,
            fee_min : params.fee_min || params.fee_value,
            ticker : params.ticker,
            caption : params.name,
            decimals : params.decimals,
            total_supply : params.total_supply,
            reissuable : params.reissuable || 0,
            minable : params.minable || 0
        };

        if(params.minable === 1){
            tok_data.max_supply =       params.max_supply;
            tok_data.block_reward =     params.block_reward;
            tok_data.min_stake =        params.min_stake;
            tok_data.referrer_stake =   params.referrer_stake;
            tok_data.ref_share =        params.ref_share;
        }
        substate.tokens_add(tok_data);
        substate.accounts_change({
            id : tx.from,
            amount : tok_data.total_supply,
            token : tx.hash,
        });
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            token_info : {
                hash : tx.hash,
                ticker : params.ticker
            }
        };
    }
}
class PosCreateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * fee : 0..10000, required
         * (opt) name : 0..40 length, any chars
         */
        let params = this.data.parameters;

        let paramsModel = ["fee"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let bigintModel = ["fee"];
        if (!bigintModel.every(key => ((typeof params[key] === undefined) || (typeof params[key] === 'bigint')))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.fee < 0 || params.fee > Utils.PERCENT_FORMAT_SIZE){
            throw new ContractError("Incorrect fee");
        }
        if(params.name){
            if((params.name.length > 40) || (typeof params.name !== "string"))
                throw new ContractError("Incorrect name format");
        }
        return true;
    }
    async execute(tx, substate) {
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        if(params.name){
            let existing = await substate.get_pos_names();
            if (existing.some(d => d.name === params.name))
                throw new ContractError(`Contract with name ${params.name} already exist`);
        }

        let pos_data = {
            id : tx.hash,
            owner : tx.from,
            fee : params.fee,
            name : params.name || null
        };
        substate.poses_add(pos_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class PosDelegateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         * amount : 0...max_supply, integer
         */
        let params = this.data.parameters;

        let paramsModel = ["pos_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        //let enq_regexp = /^(02|03)[0-9a-fA-F]{64}$/i;
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.pos_id))
            throw new ContractError("Incorrect pos_id format");
        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount < 0 || params.amount > MAX_SUPPLY_LIMIT || ((params.amount % ENQ_INTEGER_COIN) !== BigInt(0))){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check pos_id exist
         * change tx.from balance = balance - amount
         * put row in pos_leases table, increase amount
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        // Check pos contract exist
        let existing = await substate.get_pos_contract_all();
        if (!existing.some(d => d.pos_id === params.pos_id))
            throw new ContractError(`POS contract ${params.pos_id} doesn't exist`);
        let lend_data = {
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : params.amount
        };
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * BigInt(params.amount),
            token : tx.ticker,
        });
        substate.delegators_add(lend_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class PosUndelegateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         * amount : 0...max_supply, integer
         */
        let params = this.data.parameters;

        let paramsModel = ["pos_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        //let enq_regexp = /^(02|03)[0-9a-fA-F]{64}$/i;
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.pos_id))
            throw new ContractError("Incorrect pos_id format");
        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount < 0 || params.amount > MAX_SUPPLY_LIMIT || ((params.amount % ENQ_INTEGER_COIN) !== BigInt(0))){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * get lend row from delegates table
         * check amount <= delegated amount
         * decrease delegated amount
         * put ertry to undelegates table
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        let leased = await substate.get_pos_delegates(params.pos_id, tx.from);
        if(!leased)
            throw new ContractError("pos_id not found");
        if(params.amount > leased.delegated)
            throw new ContractError("Unbond amount is bigger than leased amount");

        // Amount will be deducted from current DB value in finalize_macroblock
        let delegates_data = {
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(-1) * BigInt(params.amount),
        };
        substate.delegators_change(delegates_data);
        let undelegates_data = {
            id : tx.hash,
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : params.amount,
            height : kblock.n
        };
        substate.undelegates_add(undelegates_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class PosTransferContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * undelegate_id : hex string 64 chars
         */
        let params = this.data.parameters;

        let paramsModel = ["undelegate_id"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.undelegate_id))
            throw new ContractError("Incorrect undelegate_id format");
        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * get undelegated from undelegates table by undelegated_id
         * check TRANSFER_LOCK time
         * update pos_transits
         * return new balance
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        let transfer = await substate.get_pos_undelegates(params.undelegate_id);
        if(transfer.delegator !== tx.from) {
            throw new ContractError("Undelegate TX sender and transfer TX sender doesn't match");
        }
        if(!transfer)
            throw new ContractError("Transfer not found");
        if(BigInt(transfer.amount) === BigInt(0))
            throw new ContractError("Transfer has already been processed");
        if(!this.checkTime(transfer, substate.get_transfer_lock(), kblock))
            throw new ContractError("Freeze time has not passed yet");

        let data = {
            id : params.undelegate_id,
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(0),
            height : kblock.n
        };

        substate.accounts_change({
            id : tx.from,
            amount : transfer.amount,
            token : tx.ticker,
        });
        substate.undelegates_change(data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }

    checkTime(transfer, transfer_lock, kblock){
        return (BigInt(kblock.n) - BigInt(transfer.height)) >= BigInt(transfer_lock);
    }
}
class PosGetRewardContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         */
        let params = this.data.parameters;

        let paramsModel = ["pos_id"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.pos_id))
            throw new ContractError("Incorrect pos_id format");
        return true;
    }
    async execute(tx, substate) {
        /**
         * check pos exist
         * get delegator's reward
         * change delegator's ledger amount
         * set delegator's reward to 0
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;
        let leased = await substate.get_pos_delegates(params.pos_id, tx.from);
        if(!leased)
            throw new ContractError("Delegate not found");
        if(leased.reward <=  BigInt(0))
            throw new ContractError(`Delegator ${tx.from} has no reward on contract ${params.pos_id}`);

        let data = {
            hash : tx.hash,
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(leased.reward)
        };

        substate.accounts_change({
            id : tx.from,
            amount : leased.reward,
            token : tx.ticker,
        });
        substate.claim_reward(data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class TokenMintContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * token_hash : hex string 64 chars
         * amount : 0...max_supply
         */
        let params = this.data.parameters;

        let paramsModel = ["token_hash", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.token_hash))
            throw new ContractError("Incorrect token_hash format");
        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount < 0 || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check token exist
         * check token reissuable
         * check token owner
         * check current TS + amount < MAX_SUPPLY
         * update tokens table total_supply = total_supply + amount
         * update token owner's ledger amount
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;
        let token_info = await substate.get_token_info(params.token_hash);
        if(!token_info)
            throw new ContractError("Token not found");
        if(token_info.owner !== tx.from)
            throw new ContractError("From account is not a token owner");
        if(token_info.reissuable !== 1)
            throw new ContractError("Token is not reissuable");
        if((BigInt(token_info.total_supply) + params.amount) > MAX_SUPPLY_LIMIT)
            throw new ContractError("New total supply is higher than MAX_SUPPLY");
        let data = {
            token_hash : params.token_hash,
            mint_amount : params.amount
        };
        let tok_data = {
            hash : params.token_hash,
            total_supply : params.amount
        };
        substate.tokens_change(tok_data);
        substate.accounts_change({
            id : tx.from,
            amount : params.amount,
            token : params.token_hash,
        });
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class TokenBurnContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * token_hash : hex string 64 chars
         * amount : 0...max_supply
         */
        let params = this.data.parameters;

        let paramsModel = ["token_hash", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.token_hash))
            throw new ContractError("Incorrect token_hash format");
        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount < 0 || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check token exist
         * check token reissuable
         * check token owner
         * check new amount > 0
         * update tokens table total_supply = total_supply - amount
         * update token owner's ledger amount
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;
        let token_info = await substate.get_token_info(params.token_hash);
        if(!token_info)
            throw new ContractError("Token not found");
        if(token_info.owner !== tx.from)
            throw new ContractError("From account is not a token owner");
        if(token_info.reissuable !== 1)
            throw new ContractError("Token is not reissuable");
        // if((token_info.total_supply - params.amount) < 0)
        //     throw new ContractError("Total supply can't be negative");

        let tok_data = {
            hash : params.token_hash,
            total_supply : BigInt(-1) * params.amount
        };
        substate.tokens_change(tok_data);
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * params.amount,
            token : params.token_hash,
        });
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            token_info : {
                hash : params.token_hash,
                db_supply : token_info.total_supply,
                supply_change :  BigInt(-1) * params.amount
            }
        };
    }
}
class PoolCreateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * asset_1 : hex string 64 chars
         * amount_1 : 0...max_supply
         * asset_2 : hex string 64 chars
         * amount_2 : 0...max_supply
         */
        let params = this.data.parameters;

        let paramsModel = ["asset_1", "amount_1", "asset_2", "amount_2"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.asset_1))
            throw new ContractError("Incorrect asset_1 format");
        if(!hash_regexp.test(params.asset_2))
            throw new ContractError("Incorrect asset_2 format");

        let bigintModel = ["amount_1", "amount_2"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount_1 <= BigInt(0) || params.amount_1 > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_1");
        }
        if(params.amount_2 <= BigInt(0) || params.amount_2 > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_2");
        }
        if(params.asset_1 === params.asset_2){
            throw new ContractError("asset_1 & asset_2 can not be the same");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check amount_1 * amount_2 !== 0
         * check asset_1, asset_2 exist
         * check pool exist, x_y and y_x are the same
         * check pubkey balances
         * add pool to the DB
         * decrease asset_1, asset_2 pubkey balance
         * add LT amount to pubkey
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let assets = Utils.getPairId(params.asset_1, params.asset_2);
        let pair_id = assets.pair_id;
        assets.amount_1 = (params.asset_1 === assets.asset_1) ? params.amount_1 : params.amount_2;
        assets.amount_2 = (params.asset_2 === assets.asset_2) ? params.amount_2 : params.amount_1;

        if((BigInt(assets.amount_1) * BigInt(assets.amount_2)) === BigInt(0))
            throw new ContractError(`amount_1 * amount_2 cannot be 0`);

        let native_info = await substate.get_token_info(Utils.ENQ_TOKEN_NAME);
        let token_1_info = await substate.get_token_info(assets.asset_1);
        if(!token_1_info)
            throw new ContractError(`Token ${assets.asset_1} not found`);
        let token_2_info = await substate.get_token_info(assets.asset_2);
        if(!token_2_info)
            throw new ContractError(`Token ${assets.asset_2} not found`);

        let pool_exist = await substate.dex_check_pool_exist(pair_id);
        if(pool_exist)
            throw new ContractError(`Pool ${pair_id} already exist`);

        let balance_1 = (await substate.get_balance(tx.from, assets.asset_1));
        if(BigInt(balance_1.amount) - BigInt(assets.amount_1) < BigInt(0))
            throw new ContractError(`Token ${assets.asset_1} insufficient balance`);
        let balance_2 = (await substate.get_balance(tx.from, assets.asset_2));
        if(BigInt(balance_2.amount) - BigInt(assets.amount_2) < BigInt(0))
            throw new ContractError(`Token ${assets.asset_2} insufficient balance`);

        // lt = sqrt(amount_1 * amount_2)
        let lt_amount = Utils.sqrt(assets.amount_1 * assets.amount_2);

        let pool_data = {
            pair_id : pair_id,
            asset_1 : assets.asset_1,
            volume_1 : assets.amount_1,
            asset_2 : assets.asset_2,
            volume_2 : assets.amount_2,
            pool_fee : BigInt(30),
            token_hash : tx.hash
        };

        let ticker = `LP_TKN`;
        let caption = `${token_1_info.ticker}/${token_2_info.ticker}`;
        let tok_data = {
            hash : tx.hash,
            owner : `03${Utils.ENQ_TOKEN_NAME}`,
            fee_type : 2,
            fee_value : native_info.fee_value,
            fee_min : native_info.fee_min,
            ticker : ticker,
            caption : caption,
            decimals : BigInt(10),
            total_supply : lt_amount,
            reissuable : 1,
            minable : 0
        };

        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * assets.amount_1,
            token : assets.asset_1,
        });
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * assets.amount_2,
            token : assets.asset_2,
        });
        substate.tokens_add(tok_data);
        substate.accounts_change({
            id : tx.from,
            amount : lt_amount,
            token : tx.hash,
        });
        substate.pools_add(pool_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            pool_create_lt : lt_amount
        };
    }
}
class PoolLiquidityAddContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * asset_1 : hex string 64 chars
         * amount_1 : 0...max_supply
         * asset_2 : hex string 64 chars
         * amount_2 : 0...max_supply
         */
        let params = this.data.parameters;

        let paramsModel = ["asset_1", "amount_1", "asset_2", "amount_2"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.asset_1))
            throw new ContractError("Incorrect asset_1 format");
        if(!hash_regexp.test(params.asset_2))
            throw new ContractError("Incorrect asset_2 format");

        let bigintModel = ["amount_1", "amount_2"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount_1 <= BigInt(0) || params.amount_1 > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_1");
        }
        if(params.amount_2 <= BigInt(0) || params.amount_2 > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_2");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check asset_1, asset_2 exist
         * check pool exist
         * check pubkey balances
         * add liquidity to the DB
         * add LT amount to pubkey
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let assets = Utils.getPairId(params.asset_1, params.asset_2);
        let pair_id = assets.pair_id;
        assets.amount_1 = (params.asset_1 === assets.asset_1) ? params.amount_1 : params.amount_2;
        assets.amount_2 = (params.asset_2 === assets.asset_2) ? params.amount_2 : params.amount_1;

        if((BigInt(assets.amount_1) * BigInt(assets.amount_2)) === BigInt(0))
            throw new ContractError(`amount_1 * amount_2 cannot be 0`);

        let token_1_info = (await substate.get_token_info(assets.asset_1));
        if(!token_1_info)
            throw new ContractError(`Token ${assets.asset_1} not found`);
        let token_2_info = (await substate.get_token_info(assets.asset_2));
        if(!token_2_info)
            throw new ContractError(`Token ${assets.asset_2} not found`);

        let pool_exist = (await substate.dex_check_pool_exist(pair_id));
        if(!pool_exist)
            throw new ContractError(`Pool ${assets.asset_1}_${assets.asset_2} not exist`);

        let pool_info = await substate.dex_get_pool_info(pair_id);

        let required_1 = pool_info.volume_1 * assets.amount_2 / pool_info.volume_2;
        let required_2 = pool_info.volume_2 * assets.amount_1 / pool_info.volume_1;

        let amount_1, amount_2;

        if(assets.amount_1 >= required_1){
            amount_1 = required_1;
            amount_2 = assets.amount_2;
        }
        else{
            amount_1 = assets.amount_1;
            amount_2 = required_2
        }

        // lt = sqrt(amount_1 * amount_2)
        let lt_amount = Utils.sqrt(amount_1 * amount_2);

        let balance_1 = (await substate.get_balance(tx.from, assets.asset_1));
        if(BigInt(balance_1.amount) - BigInt(amount_1) < BigInt(0))
            throw new ContractError(`Token ${assets.asset_1} insufficient balance`);
        let balance_2 = (await substate.get_balance(tx.from, assets.asset_2));
        if(BigInt(balance_2.amount) - BigInt(amount_2) < BigInt(0))
            throw new ContractError(`Token ${assets.asset_2} insufficient balance`);

        let pool_data = {
            pair_id : pair_id,
            asset_1 : assets.asset_1,
            volume_1 : amount_1,
            asset_2 : assets.asset_2,
            volume_2 : amount_2
        };
        let tok_data = {
            hash : pool_info.token_hash,
            total_supply : lt_amount
        };

        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * amount_1,
            token : assets.asset_1,
        });
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * amount_2,
            token : assets.asset_2,
        });
        substate.accounts_change({
            id : tx.from,
            amount : lt_amount,
            token : pool_info.token_hash,
        });
        substate.pools_change(pool_data);
        substate.tokens_change(tok_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            liq_add_lt : lt_amount
        };
    }
}
class PoolLiquidityRemoveContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * lt : hex string 64 chars
         * amount : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["lt", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.lt))
            throw new ContractError("Incorrect lt format");

        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount <= BigInt(0) || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check lt exist
         * check pool exist
         * check pubkey lt balance
         * decrease pool liquidity
         * decrease lt balance
         * increase pubkey balances
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        // TODO: this is probably unnececcary checks
        let token_info = (await substate.get_token_info(params.lt));
        if(!token_info)
            throw new ContractError(`Token ${params.lt} not found`);

        let balance = (await substate.get_balance(tx.from, params.lt));
        if(BigInt(balance.amount) - BigInt(params.amount) < BigInt(0))
            throw new ContractError(`Token ${params.lt} insufficient balance`);

        let pool_info = await substate.get_dex_pool_info_by_token(params.lt);

        //amount_1 = volume_1 * amount / lt_emission
        //amount_2 = volume_2 * amount / lt_emission
        let amount_1 = pool_info.volume_1 * params.amount / token_info.total_supply;
        let amount_2 = pool_info.volume_2 * params.amount / token_info.total_supply;

        let pool_data = {
            pair_id : `${pool_info.asset_1}${pool_info.asset_2}`,
            asset_1 : pool_info.asset_1,
            volume_1 : BigInt(-1) * amount_1,
            asset_2 : pool_info.asset_2,
            volume_2 : BigInt(-1) * amount_2
        };
        let tok_data = {
            hash : pool_info.token_hash,
            total_supply : BigInt(-1) * params.amount
        };

        substate.accounts_change({
            id : tx.from,
            amount : amount_1,
            token : pool_info.asset_1,
        });
        substate.accounts_change({
            id : tx.from,
            amount : amount_2,
            token : pool_info.asset_2,
        });
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * params.amount,
            token : pool_info.token_hash,
        });
        substate.pools_change(pool_data);
        substate.tokens_change(tok_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            liq_remove : {
                liq_remove1 : amount_1,
                liq_remove2 : amount_2
            }
        };
    }
}
class PoolLiquiditySwapContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * asset_in : hex string 64 chars
         * asset_out : hex string 64 chars
         * amount_in : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["asset_in", "asset_out", "amount_in"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.asset_in))
            throw new ContractError("Incorrect asset_in format");
        if(!hash_regexp.test(params.asset_out))
            throw new ContractError("Incorrect asset_out format");

        let bigintModel = ["amount_in"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount_in <= BigInt(0) || params.amount_in > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_in");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check asset_in, asset_out exist
         * check pool exist
         * check pubkey amount_in balance
         * change pool liquidity
         * decrease pubkey amount_in balances
         * increase pubkey amount_out balances
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let BURN_ADDRESS = Utils.DEX_BURN_ADDRESS;
        let CMD_ADDRESS = Utils.DEX_COMMANDER_ADDRESS;
        let ENX_TOKEN_HASH = "824e7b171c01e971337c1b25a055023dd53c003d4aa5aa8b58a503d7c622651e";

        let assets = Utils.getPairId(params.asset_in, params.asset_out);
        let pair_id = assets.pair_id;

        let pool_exist = await substate.dex_check_pool_exist(pair_id);
        if(!pool_exist)
            throw new ContractError(`Pool ${pair_id} not exist`);

        let pool_info = await substate.dex_get_pool_info(pair_id);
        let lt_info = await substate.get_token_info(pool_info.token_hash);

        let volume_in =  params.asset_in === pool_info.asset_1 ? pool_info.volume_1 : pool_info.volume_2;
        let volume_out = params.asset_in === pool_info.asset_2 ? pool_info.volume_1 : pool_info.volume_2;
        let k = volume_in * volume_out;

        if(params.amount_in > k - volume_in)
            throw new ContractError(`Too much liquidity for pool ${pair_id}`);

        // amount_out = volume_2 - k/(volume_1 + amount_in)
        let amount_out = volume_out - (k / (volume_in + (params.amount_in * (Utils.PERCENT_FORMAT_SIZE - pool_info.pool_fee) / Utils.PERCENT_FORMAT_SIZE)));
        // cmd_tokens = lp_total * cmd_fee * amount_in / volume_1
        let cmd_lt_amount = ((lt_info.total_supply * Utils.DEX_COMMANDER_FEE) / Utils.PERCENT_FORMAT_SIZE) * params.amount_in / volume_in;

        let lt_assets = Utils.getPairId(ENX_TOKEN_HASH, pool_info.token_hash);
        let lt_pair_id = lt_assets.pair_id;
        let lt_pool_exist = await substate.dex_check_pool_exist(lt_pair_id);
        if(lt_pool_exist){
            substate.accounts_change({
                id : CMD_ADDRESS,
                amount : cmd_lt_amount,
                token : pool_info.token_hash,
            });
        }
        else {
            substate.accounts_change({
                id : BURN_ADDRESS,
                amount : cmd_lt_amount,
                token : pool_info.token_hash,
            });
        }

        let pool_data = {
            pair_id : `${pool_info.asset_1}${pool_info.asset_2}`,
            volume_1 : (params.asset_in === pool_info.asset_1) ? (params.amount_in) : (BigInt(-1) * amount_out),
            volume_2 : (params.asset_in === pool_info.asset_1) ? (BigInt(-1) * amount_out) : (params.amount_in)
        };

        let tok_data = {
            hash : pool_info.token_hash,
            total_supply : cmd_lt_amount
        };
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * params.amount_in,
            token : params.asset_in,
        });
        substate.accounts_change({
            id : tx.from,
            amount : amount_out,
            token : params.asset_out,
        });
        substate.tokens_change(tok_data);
        substate.pools_change(pool_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            dex_swap : {
                in : params.amount_in,
                out : amount_out
            }
        };
    }
}

class FarmCreateContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * stake_token : hex string 64 chars
         * reward_token : hex string 64 chars
         * block_reward : 0...MAX_SUPPLY_LIMIT
         * emission : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["stake_token", "reward_token", "block_reward", "emission"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.stake_token))
            throw new ContractError("Incorrect stake_token format");
        if(!hash_regexp.test(params.reward_token))
            throw new ContractError("Incorrect reward_token format");

        let bigintModel = ["block_reward", "emission"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.block_reward <= BigInt(0) || params.block_reward > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect block_reward");
        }
        if(params.emission <= BigInt(0) || params.emission > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect emission");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check stake_token, reward_token exist
         * check block_reward <= emission
         * add record to farms table
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let stake_token_info = await substate.get_token_info(params.stake_token);
        if(!stake_token_info)
            throw new ContractError(`Token ${params.stake_token} not found`);
        let reward_token_info = await substate.get_token_info(params.reward_token);
        if(!reward_token_info)
            throw new ContractError(`Token ${params.reward_token} not found`);

        let balance = (await substate.get_balance(tx.from, params.reward_token));
        if(BigInt(balance.amount) - BigInt(params.emission) < BigInt(0))
            throw new ContractError(`Token ${params.reward_token} insufficient balance`);

        // let balance_1 = (await substate.get_balance(tx.from, params.stake_token));
        // if(BigInt(balance_1.amount) - BigInt(params.stake_token) < BigInt(0))
        //     throw new ContractError(`Token ${params.stake_token} insufficient balance`);
        // let balance_2 = (await substate.get_balance(tx.from, params.reward_token));
        // if(BigInt(balance_2.amount) - BigInt(params.reward_token) < BigInt(0))
        //     throw new ContractError(`Token ${params.reward_token} insufficient balance`);

        let farm_data = {
            farm_id : tx.hash,
            stake_token : params.stake_token,
            reward_token : params.reward_token,
            emission : params.emission,
            block_reward : params.block_reward,
            level : BigInt(0),
            total_stake : BigInt(0),
            last_block : BigInt(0)
        };

        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1 ) * params.emission,
            token : params.reward_token,
        });
        substate.farms_add(farm_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class FarmsAddFundsContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         * amount : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount <= BigInt(0) || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check farm exist
         * check farm_id.reward_token balance
         * decrease farm_id.reward_token balance
         * increase farm reward
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        // let reward_token_info = await substate.get_token_info(params.reward_token);
        // if(!reward_token_info)
        //     throw new ContractError(`Token ${params.reward_token} not found`);
        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);

        let balance = (await substate.get_balance(tx.from, farm.reward_token));
        if(BigInt(balance.amount) - BigInt(params.amount) < BigInt(0))
            throw new ContractError(`Token ${params.reward_token} insufficient balance`);

        let farm_data = {
            farm_id : farm.farm_id,
            emission : params.amount
        };
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1 ) * params.amount,
            token : farm.reward_token,
        });
        substate.farms_change(farm_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class FarmsAddEmissionContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         * amount : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount <= BigInt(0) || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * check farm exist
         * check farm_id.reward_token balance
         * decrease farm_id.reward_token balance
         * increase farm reward
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        // let reward_token_info = await substate.get_token_info(params.reward_token);
        // if(!reward_token_info)
        //     throw new ContractError(`Token ${params.reward_token} not found`);
        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);

        let balance = (await substate.get_balance(tx.from, farm.reward_token));
        if(BigInt(balance.amount) - BigInt(params.amount) < BigInt(0))
            throw new ContractError(`Token ${farm.reward_token} insufficient balance`);

        let _d = (BigInt(kblock.n) - farm.last_block) * farm.block_reward;
        let distributed = _d < farm.emission ? _d : farm.emission;
        let new_level = BigInt(farm.level) + (distributed * LEVEL_DECIMALS) / farm.total_stake;
        // TODO: accumulator
        let farm_data = {
            farm_id : farm.farm_id,
            level : new_level
        };

        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1 ) * params.amount,
            token : farm.reward_token,
        });
        substate.farms_change(farm_data);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}

class DexCmdDistributeContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        return true;
    }
    async execute(tx, substate, kblock, config) {
        /**
         * Check cmd's balance
         * get ltoken pool
         * swap lp_token to ENX
         * Add ENX to farm
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let ENX_TOKEN_HASH = "145e5feb2012a2db325852259fc6b8a6fd63cc5188a89bac9f35139fc8664fd2";

//        let ENX_TOKEN_HASH  = "824e7b171c01e971337c1b25a055023dd53c003d4aa5aa8b58a503d7c622651e";
        let ENX_FARM_ID     = "42b199033fc1e3d398f870d8934047caaf4b313c18b25ccea58ab607fce2a557";

        let balance = (await substate.get_balance(Utils.DEX_COMMANDER_ADDRESS, params.token_hash));
        if(BigInt(balance.amount) <= BigInt(0))
            throw new ContractError(`Token ${params.token_hash} insufficient balance`);

        let assets = Utils.getPairId(params.token_hash, ENX_TOKEN_HASH);
        let pair_id = assets.pair_id;

        let pool_exist = (await substate.dex_check_pool_exist(pair_id));
        if(!pool_exist)
            throw new ContractError(`Pool ${assets.asset_1}_${assets.asset_2} not exist`);

        let pool_info = await substate.dex_get_pool_info(pair_id);

        let swap_object = {
            type : "pool_swap",
            parameters : {
                asset_in : params.token_hash,
                asset_out : ENX_TOKEN_HASH,
                amount_in : BigInt(balance.amount)
            }
        };

        // TODO: ??? pass config with dchema
        //let config = {};
        let factory = new ContractMachine.ContractFactory(config);
        let parser = new ContractParser(config);

        let swap_data = parser.dataFromObject(swap_object);
        let swap_contract = factory.createContract(swap_data);
        // TODO: ??? change tx object
        tx.from = Utils.DEX_COMMANDER_ADDRESS;
        let swap_res = await swap_contract.execute(tx, substate);

        let balance_enx = (await substate.get_balance(Utils.DEX_COMMANDER_ADDRESS, ENX_TOKEN_HASH));
        if(BigInt(balance_enx.amount) <= BigInt(0))
            throw new ContractError(`Token ${ENX_TOKEN_HASH} insufficient balance`);

        let dist_object = {
            type : "farm_add_emission",
            parameters : {
                farm_id : ENX_FARM_ID,
                amount : balance_enx.amount
            }
        };

        let dist_data = parser.dataFromObject(dist_object);
        let dist_contract = factory.createContract(dist_data);
        // TODO: ??? change tx object
        let dist_res = await dist_contract.execute(tx, substate, kblock);

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}

class FarmIncreaseStakeContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         * amount : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount <= BigInt(0) || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * check farm exist
         * check farm_id.stake_token balance
         *
         * decrease farm_id.stake_token balance
         * change farm total_stake,
         *
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);
        let farmer = await substate.get_farmer(params.farm_id, tx.from);
        if(!farmer){
            farmer = {
                farm_id : params.farm_id,
                farmer_id : tx.from,
                stake : BigInt(0),
                level : BigInt(0)
            }
        }
        let balance = await substate.get_balance(tx.from, farm.stake_token);
        if(BigInt(balance.amount) - BigInt(params.amount) < BigInt(0))
            throw new ContractError(`Token ${farm.stake_token} insufficient balance`);

        let distributed = BigInt(0);
        let new_level = BigInt(0);
        if (farm.total_stake > BigInt(0)){
            let _d = (BigInt(kblock.n) - farm.last_block) * farm.block_reward;
            distributed = _d < farm.emission ? _d : farm.emission;
            new_level = BigInt(farm.level) + (distributed * LEVEL_DECIMALS) / farm.total_stake;
        }
        let farmer_level = new_level;
        if(farmer.stake > BigInt(0)){
            let farmer_reward = farmer.stake * (new_level - BigInt(farmer.level));
            let farmer_stake = farmer.stake + params.amount;
            farmer_level = new_level - (farmer_reward / farmer_stake);
        }

        let farm_data = {
            farm_id : params.farm_id,
            total_stake : params.amount,
            level : new_level,
            emission : BigInt(-1) * distributed,
            last_block : BigInt(kblock.n)
        };
        let farmer_data = {
            farm_id : farm.farm_id,
            farmer_id : tx.from,
            level : farmer_level,
            stake : params.amount
        };
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1 ) * params.amount,
            token : farm.stake_token,
        });
        substate.farms_change(farm_data);
        substate.farmers_change(farmer_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class FarmDecreaseStakeContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         * amount : 0...MAX_SUPPLY_LIMIT
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id", "amount"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        let bigintModel = ["amount"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount <= BigInt(0) || params.amount > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount");
        }
        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * check farm exist
         * check farm_id.stake_token balance
         *
         * decrease farm_id.stake_token balance
         * change farm total_stake,
         *
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);
        let farmer = await substate.get_farmer(params.farm_id, tx.from);
        if(!farmer){
            farmer = {
                farm_id : params.farm_id,
                farmer_id : tx.from,
                stake : BigInt(0),
                level : BigInt(0)
            }
        }
        if(params.amount > farmer.stake)
            throw new ContractError(`Amount is higher than farmer stake`);

        let distributed = BigInt(0);
        let new_level = BigInt(0);
        if (farm.total_stake > BigInt(0)){
            let _d = (BigInt(kblock.n) - farm.last_block) * farm.block_reward;
            distributed = _d < farm.emission ? _d : farm.emission;
            new_level = BigInt(farm.level) + (distributed * LEVEL_DECIMALS) / farm.total_stake;
        }

        let farmer_reward = farmer.stake * (new_level - BigInt(farmer.level)) / LEVEL_DECIMALS;

        let farm_data = {
            farm_id : params.farm_id,
            total_stake : BigInt(-1) * params.amount,
            level : new_level,
            emission : BigInt(-1) * distributed,
            last_block : BigInt(kblock.n)
        };
        let farmer_data = {
            farm_id : farm.farm_id,
            farmer_id : tx.from,
            stake : BigInt(-1) * params.amount
        };
        substate.accounts_change({
            id : tx.from,
            amount : params.amount,
            token : farm.stake_token,
        });
        if(farmer_reward > BigInt(0)){
            substate.accounts_change({
                id : tx.from,
                amount : farmer_reward,
                token : farm.reward_token,
            });
        }
        substate.farms_change(farm_data);
        substate.farmers_change(farmer_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            farm_decrease_reward : farmer_reward
        };
    }
}
class FarmCloseStakeContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * check farm exist
         * check farm_id.stake_token balance
         *
         * decrease farm_id.stake_token balance
         * change farm total_stake,
         *
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);

        let farmer = await substate.get_farmer(params.farm_id, tx.from);
        if(!farmer){
            throw new ContractError(`Farm_farmer ${params.farm_id}_${tx.from} not found`);
        }

        let _d = (BigInt(kblock.n) - farm.last_block) * farm.block_reward;
        let distributed = _d < farm.emission ? _d : farm.emission;

        let new_level = BigInt(farm.level) + (distributed * LEVEL_DECIMALS) / farm.total_stake;
        let farmer_reward = farmer.stake * (new_level - BigInt(farmer.level)) / LEVEL_DECIMALS;

        let farm_data = {
            farm_id : params.farm_id,
            total_stake : BigInt(-1) * farmer.stake,
            level : new_level,
            emission : BigInt(-1) * distributed,
            last_block : BigInt(kblock.n)
        };
        let farmer_data = {
            farm_id : farm.farm_id,
            farmer_id : tx.from
        };
        substate.accounts_change({
            id : tx.from,
            amount : farmer.stake,
            token : farm.stake_token,
        });
        substate.accounts_change({
            id : tx.from,
            amount : farmer_reward,
            token : farm.reward_token,
        });
        substate.farms_change(farm_data);
        substate.farmers_delete(farmer_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            farm_close_reward : farmer_reward
        };
    }
}
class FarmGetRewardContract extends Contract {
    constructor(data) {
        super();
        this.data = data;
        this.type = this.data.type;
        if(!this.validate())
            throw new ContractError("Incorrect contract");
    }
    validate() {
        /**
         * parameters:
         * farm_id : hex string 64 chars
         */
        let params = this.data.parameters;

        let paramsModel = ["farm_id"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.farm_id))
            throw new ContractError("Incorrect farm_id format");

        return true;
    }
    async execute(tx, substate, kblock) {
        /**
         * check farm exist
         * check farm_id.stake_token balance
         *
         * change farmer level
         * change farm emission, level
         * add reward to account
         *
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let farm = await substate.get_farm(params.farm_id);
        if(!farm)
            throw new ContractError(`Farm ${params.farm_id} doesn't exist`);

        let farmer = await substate.get_farmer(params.farm_id, tx.from);
        if(!farmer){
            throw new ContractError(`Farm_farmer ${params.farm_id}_${tx.from} not found`);
        }

        let _d = (BigInt(kblock.n) - farm.last_block) * farm.block_reward;
        let distributed = _d < farm.emission ? _d : farm.emission;

        let new_level = BigInt(farm.level) + (distributed * LEVEL_DECIMALS) / farm.total_stake;
        let farmer_reward = farmer.stake * (new_level - BigInt(farmer.level)) / LEVEL_DECIMALS;

        let farm_data = {
            farm_id : params.farm_id,
            level : new_level,
            emission : BigInt(-1) * distributed,
            last_block : BigInt(kblock.n)
        };
        let farmer_data = {
            farm_id : farm.farm_id,
            farmer_id : tx.from,
            level : new_level
        };
        substate.accounts_change({
            id : tx.from,
            amount : farmer_reward,
            token : farm.reward_token,
        });
        substate.farms_change(farm_data);
        substate.farmers_change(farmer_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [],
            farm_reward : farmer_reward
        };
    }
}

module.exports.Contract = Contract;

module.exports.TokenCreateContract = TokenCreateContract;
module.exports.TokenMintContract = TokenMintContract;
module.exports.TokenBurnContract = TokenBurnContract;

module.exports.PosCreateContract = PosCreateContract;
module.exports.PosDelegateContract = PosDelegateContract;
module.exports.PosUndelegateContract = PosUndelegateContract;
module.exports.PosTransferContract = PosTransferContract;
module.exports.PosGetRewardContract = PosGetRewardContract;

module.exports.PoolCreateContract = PoolCreateContract;
module.exports.PoolLiquidityAddContract = PoolLiquidityAddContract;
module.exports.PoolLiquidityRemoveContract = PoolLiquidityRemoveContract;
module.exports.PoolLiquiditySwapContract = PoolLiquiditySwapContract;

module.exports.FarmCreateContract = FarmCreateContract;
module.exports.FarmIncreaseStakeContract = FarmIncreaseStakeContract;
module.exports.FarmDecreaseStakeContract = FarmDecreaseStakeContract;
module.exports.FarmCloseStakeContract = FarmCloseStakeContract;
module.exports.FarmGetRewardContract = FarmGetRewardContract;
module.exports.FarmsAddEmissionContract = FarmsAddEmissionContract;

module.exports.DexCmdDistributeContract = DexCmdDistributeContract;