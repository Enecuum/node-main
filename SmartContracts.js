/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * SmartContracts.js
 * Enecuum smart contracts logic
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');
const {ContractError} = require('./errors');
const {OutOfRangeError} = require('./errors');
const ContractParser = require('./contractParser').ContractParser;
const fs = require('fs');
let config = {};
try {
    config = JSON.parse(fs.readFileSync('./config.pulse', 'utf8'));

} catch (e) {
    console.info('No configuration file found.', e)
}

let schema = {
    "root" :            "0000",
    "custom" :          "0100",
    "create_token" :    "0200",
    "delegate" :        "0300",
    "undelegate" :      "0400",
    "signature" :       "0500",
    "hash" :            "0600",
    "string" :          "0700",
    "int" :             "0800",
    "bigint" :          "0900",
    "float" :           "0a00",
    "object" :          "0c00",
    "key" :             "0d00",
    "procedure_name" :  "0e00",
    "parameters" :      "0f00",
    "create_pos" :      "1000",
    "pos_reward" :      "1100",
    "transfer" :        "1200",
    "mint" :            "1300",
    "burn" :            "1400",
    "create_pool" :     "1500"
};

let contract_pricelist = config.contract_pricelist;

//let MAX_SUPPLY = BigInt('18446744073709551615');
let MAX_SUPPLY_LIMIT = BigInt('18446744073709551615');
let MAX_DECIMALS = BigInt(10);
let ENQ_INTEGER_COIN = BigInt(10000000000);

let parser = new ContractParser(schema, contract_pricelist);

// TODO: possible false-positive results because of data field format
function isContract(raw) {
    return parser.isContract(raw);
}

function parse(raw){
    return parser.parse(raw);
}

async function processData(tx, db, kblock){
    let contract = Contract.createContract(tx.data);
    if(!contract)
        return false;
    if(tx.amount < BigInt(contract_pricelist[contract.type])){
        throw new ContractError("Invalid amount");
    }
    if(tx.to !== db.ORIGIN.publisher){
        throw new ContractError(`Invalid recipient address, expected ${db.ORIGIN.publisher} , given ${tx.to}`);
    }
    if(tx.ticker !== Utils.ENQ_TOKEN_NAME){
        throw new ContractError(`Invalid token, expected ${Utils.ENQ_TOKEN_NAME} , given ${tx.ticker}`);
    }
    return contract.execute(tx, db, kblock);
}

function validate(data){
    let contract = Contract.createContract(data);
    if(!contract)
        return false;
    return contract.validate(data);
}

function create(tx, db){
    let contract = Contract.createContract(tx.data);
    if(!contract)
        return false;
    if(tx.amount < BigInt(contract_pricelist[contract.type])){
        throw new ContractError("Invalid amount");
    }
    if(tx.to !== db.ORIGIN.publisher){
        throw new ContractError(`Invalid recipient address, expected ${db.ORIGIN.publisher} , given ${tx.to}`);
    }
    if(tx.ticker !== Utils.ENQ_TOKEN_NAME){
        throw new ContractError(`Invalid token, expected ${Utils.ENQ_TOKEN_NAME} , given ${tx.ticker}`);
    }
    return contract;
}

class Contract{
    constructor() {
        this._mysql = require('mysql');
        this.type = null;
    }
    static createContract(data){
        this.type = isContract(data);
        switch(this.type) {
            case "create_token" :   return new CreateTokenContract(data);
            case "create_pos" :     return new CreatePosContract(data);
            case "delegate" :       return new DelegateContract(data);
            case "undelegate" :     return new UndelegateContract(data);
            case "transfer" :       return new TransferContract(data);
            case "pos_reward" :     return new PosRewardContract(data);
            case "mint" :           return new MintTokenContract(data);
            case "burn" :           return new BurnTokenContract(data);
            case "create_pool" :    return new DexPoolCreateContract(data);
            case "add_liquidity" :  return new DexLiquidityAddContract(data);
            case "remove_liquidity" : return new DexLiquidityRemoveContract(data);
            case "swap" :           return new DexLiquiditySwapContract(data);
            default : return null;
        }
    }
    get mysql(){
        return this._mysql;
    }
}
class CreateTokenContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {

        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let contractType = data.type;
        let params = data.parameters;
        // Parse tx data - error on fail
        // Check tx type - error on unknown type
        if(!contract_pricelist.hasOwnProperty(contractType)){
            throw new ContractError("Unknown contract type");
        }
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

        // Check token exist
        let existing = await substate.get_tickers_all();
        if (existing.some(d => d.ticker === params.ticker))
            throw new ContractError(`Ticker ${params.ticker} already exist`);

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
class CreatePosContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * fee : 0..10000, required
         * (opt) name : 0..40 length, any chars
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
class DelegateContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         * amount : 0...max_supply, integer
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
class UndelegateContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         * amount : 0...max_supply, integer
         */
        //let MAX_SUPPLY = 512000 * 1e10;
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
class TransferContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * undelegate_id : hex string 64 chars
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
        let und_tx = (await substate.db.get_tx(params.undelegate_id))[0];
        if(und_tx === undefined) {
            throw new ContractError("Undelegate TX not found");
        }
        if(und_tx.status !== 3) {
            throw new ContractError("Invalid undelegate TX status");
        }
        if(und_tx.from !== tx.from) {
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
        if(kblock.n < config.FORKS.fork_block_001){
            console.info(`Transfer contract before ${config.FORKS.fork_block_001} block, rejected`);
            return false;
        }
        else return (BigInt(kblock.n) - BigInt(transfer.height)) >= BigInt(transfer_lock);
    }
}
class PosRewardContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * pos_id : hex string 64 chars
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(-1) * BigInt(leased.reward)
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
class MintTokenContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * token_hash : hex string 64 chars
         * amount : 0...max_supply
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
class BurnTokenContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * token_hash : hex string 64 chars
         * amount : 0...max_supply
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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
        let data = {
            token_hash : params.token_hash,
            burn_amount : params.amount
        };
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
class DexPoolCreateContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * asset_1 : hex string 64 chars
         * amount_1 : 0...max_supply
         * asset_2 : hex string 64 chars
         * amount_2 : 0...max_supply
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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

        let assets = getPairId(params.asset_1, params.asset_2);
        let pair_id = assets.pair_id;
        assets.amount_1 = (params.asset_1 === assets.asset_1) ? params.amount_1 : params.amount_2;
        assets.amount_2 = (params.asset_2 === assets.asset_2) ? params.amount_2 : params.amount_1;

        if((BigInt(assets.amount_1) * BigInt(assets.amount_2)) === BigInt(0))
            throw new ContractError(`amount_1 * amount_2 cannot be 0`);

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
        // TODO: take pool_fee from params
        let pool_data = {
            pool_id : tx.hash,
            pair_id : pair_id,
            asset_1 : assets.asset_1,
            amount_1 : assets.amount_1,
            asset_2 : assets.asset_2,
            amount_2 : assets.amount_2,
            pool_fee : BigInt(0),
            lp_token : tx.hash
        };
        let tok_data = {
            hash : tx.hash,
            owner : tx.from,
            fee_type : 0,
            fee_value : BigInt(0),
            fee_min : BigInt(0),
            ticker : crypto.randomBytes(6),
            caption : crypto.randomBytes(6),
            decimals : BigInt(10),
            total_supply : lt_amount,
            reissuable : 1,
            minable : 0
        };

        substate.tokens_add(tok_data);
        substate.accounts_change({
            id : tx.from,
            amount : lt_amount,
            token : tx.hash,
        });

        substate.pools_add(pool_data);
        let lt_data = {
            pool_id : tx.hash,
            pair_id : pair_id,
            id : tx.from,
            amount : lt_amount
        };
        substate.lt_add(lt_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class DexLiquidityAddContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * asset_1 : hex string 64 chars
         * amount_1 : 0...max_supply
         * asset_2 : hex string 64 chars
         * amount_2 : 0...max_supply
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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

        let pair_id = getPairId(params.asset_1, params.asset_2);
        if((BigInt(params.amount_1) * BigInt(params.amount_2)) === BigInt(0))
            throw new ContractError(`amount_1 * amount_2 cannot be 0`);

        let token_1_info = (await substate.get_token_info(params.asset_1));
        if(!token_1_info)
            throw new ContractError(`Token ${params.asset_1} not found`);
        let token_2_info = (await substate.get_token_info(params.asset_2));
        if(!token_2_info)
            throw new ContractError(`Token ${params.asset_2} not found`);

        let pool_exist = (await substate.dex_check_pool_exist(pair_id));
        if(!pool_exist)
            throw new ContractError(`Pool ${params.asset_1}_${params.asset_2} not exist`);

        // TODO: dex_get_pool_info in substate
        let pool_info = (await substate.dex_get_pool_info(pair_id))[0];

        let required_1 = pool_info.volume_1 * params.amount_2 / pool_info.volume_2;
        let required_2 = pool_info.volume_2 * params.amount_1 / pool_info.volume_1;

        let amount_1, amount_2;

        if(params.amount_1 >= required_1){
            amount_1 = required_1;
            amount_2 = params.amount_2;
        }
        else{
            amount_1 = params.amount_1;
            amount_2 = required_2
        }

        pool_info.volume_1 += amount_1;
        pool_info.volume_2 += amount_2;

        // lt = sqrt(amount_1 * amount_2)
        let lt_amount = Utils.sqrt(amount_1 * amount_2);

        let balance_1 = (await substate.get_balance(tx.from, params.asset_1));
        if(BigInt(balance_1.amount) - BigInt(amount_1) < BigInt(0))
            throw new ContractError(`Token ${params.asset_1} insufficient balance`);
        let balance_2 = (await substate.get_balance(tx.from, params.asset_2));
        if(BigInt(balance_2.amount) - BigInt(amount_2) < BigInt(0))
            throw new ContractError(`Token ${params.asset_2} insufficient balance`);

        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * amount_1,
            token : params.asset_1,
        });
        substate.accounts_change({
            id : tx.from,
            amount : BigInt(-1) * amount_2,
            token : params.asset_2,
        });
        let pool_data = {
            pair_id : pair_id,
            asset_1 : params.asset_1,
            amount_1 : params.amount_1,
            asset_2 : params.asset_2,
            amount_2 : params.amount_2
        };
        substate.pools_change(pool_data);
        let lt_data = {
            pair_id : pair_id,
            id : tx.from,
            amount : lt_amount
        };
        substate.lt_change(lt_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
    sqlAddLiquidity(data) {
        return super.mysql.format(`UPDATE dex_pools SET amount_1 = amount_1 + ?, amount_2 = amount_2 + ? WHERE pair_id = ? `,
            [data.amount_1, data.amount_2, data.pair_id]);
    }
    sqlMintLiquidityToken(data) {
        return super.mysql.format(`UPDATE dex_tokens SET amount = amount + ? WHERE pair_id = ? AND id = ?`,
            [data.amount, data.pair_id, data.id]);
    }
}
class DexLiquidityRemoveContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * asset_1 : hex string 64 chars
         * asset_2 : hex string 64 chars
         * amount_lt : 0...MAX_SUPPLY_LIMIT
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

        let paramsModel = ["asset_1", "asset_2", "amount_lt"];
        if (paramsModel.some(key => params[key] === undefined)){
            throw new ContractError("Incorrect param structure");
        }
        let hash_regexp = /^[0-9a-fA-F]{64}$/i;
        if(!hash_regexp.test(params.asset_1))
            throw new ContractError("Incorrect asset_1 format");
        if(!hash_regexp.test(params.asset_2))
            throw new ContractError("Incorrect asset_2 format");

        let bigintModel = ["amount_lt"];
        if (!bigintModel.every(key => (typeof params[key] === 'bigint'))){
            throw new ContractError("Incorrect field format, BigInteger expected");
        }
        if(params.amount_lt <= BigInt(0) || params.amount_lt > MAX_SUPPLY_LIMIT){
            throw new ContractError("Incorrect amount_lt");
        }
        return true;
    }
    async execute(tx, substate) {
        /**
         * check asset_1, asset_2 exist
         * check pool exist
         * check pubkey lt balance
         * decrease pool liquidity
         * decrease lt balance
         * increase pubkey balances
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;

        let pair_id = getPairId(params.asset_1, params.asset_2);

        // TODO: this is probably unnececcary checks
        let token_1_info = (await substate.get_token_info(params.asset_1));
        if(!token_1_info)
            throw new ContractError(`Token ${params.asset_1} not found`);
        let token_2_info = (await substate.get_token_info(params.asset_2));
        if(!token_2_info)
            throw new ContractError(`Token ${params.asset_2} not found`);

        let pool_exist = (await substate.dex_check_pool_exist(pair_id));
        if(!pool_exist)
            throw new ContractError(`Pool ${params.asset_1}_${params.asset_2} not exist`);

        let pool_info = (await substate.dex_get_pool_info(pair_id))[0];


        let pool_data = {
            pool_id : params.token_hash,
            asset_1 : params.asset_1,
            amount_1 : params.amount_1,
            asset_2 : params.asset_2,
            amount_2 : params.amount_2
        };
        substate.pools_change(pool_data);

        let lt_data = {
            pool_id : params.token_hash,
            id : tx.from,
            amount : lt_amount
        };
        substate.lt_change(lt_data);
        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}
class DexLiquiditySwapContract extends Contract {
    constructor(data) {
        super();
        if(!this.validate(data))
            throw new ContractError("Incorrect contract");
        this.data = parse(data);
        this.type = this.data.type;
    }
    validate(raw) {
        /**
         * parameters:
         * asset_in : hex string 64 chars
         * asset_out : hex string 64 chars
         * amount_in : 0...MAX_SUPPLY_LIMIT
         */
        if(!isContract(raw))
            return false;
        let data = parse(raw);
        let params = data.parameters;

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

        let pair_id = getPairId(params.asset_in, params.asset_out);

        // TODO: this is probably unnececcary checks
        // let token_1_info = (await db.get_tokens_all(params.asset_in))[0];
        // if(!token_1_info)
        //     throw new ContractError(`Token ${params.asset_1} not found`);
        // let token_2_info = (await db.get_tokens_all(params.asset_out))[0];
        // if(!token_2_info)
        //     throw new ContractError(`Token ${params.asset_2} not found`);

        let pool_exist = (await db.dex_check_pool_exist(pair_id))[0];
        if(!pool_exist)
            throw new ContractError(`Pool ${pair_id} not exist`);

        let pool_info = (await db.dex_get_pool_info(pair_id))[0];
        let amount_1, amount_2;

        let k = pool_info.amount_1 * pool_info.amount_2;

        // amount_out = volume_2 - k/(volume_1 + amount_in)
        let amount_out = (BigInt(k)) / params.amount_in;

        if(pool_info.asset_1 === params.asset_in){
            amount_1 = params.amount_in;
            amount_2 = amount_out;
        }
        else {
            amount_1 = amount_out;
            amount_2 = params.amount_in;
        }

        // // Take amount_in
        //         // substate.accounts_change({
        //         //     id : tx.from,
        //         //     amount : leased.reward,
        //         //     token : tx.ticker,
        //         // });
        //         // // Give amount_out
        //         // substate.accounts_change({
        //         //     id : tx.from,
        //         //     amount : leased.reward,
        //         //     token : tx.ticker,
        //         // });
        let pool_data = {
            pool_id : params.token_hash,
            asset_1 : params.asset_1,
            amount_1 : params.amount_1 + amount_1,
            asset_2 : params.asset_2,
            amount_2 : params.amount_2 + amount_2
        };

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : []
        };
    }
}

function getPairId(asset_1, asset_2){
    if(BigInt(`0x${asset_1}`) < BigInt(`0x${asset_2}`))
        return {
            pair_id : `${asset_1}${asset_2}`,
            asset_1 : asset_1,
            asset_2 : asset_2
        };
    else return {
        pair_id : `${asset_2}${asset_1}`,
        asset_1 : asset_2,
        asset_2 : asset_1
    };
}

module.exports.processData = processData;
module.exports.create = create;
module.exports.getPairId = getPairId;
module.exports.isContract = isContract;
module.exports.validate = validate;
module.exports.contract_pricelist = contract_pricelist;
module.exports.Contract = Contract;