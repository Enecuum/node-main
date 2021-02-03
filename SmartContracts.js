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
const config = require('./config.json');
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
    "burn" :            "1400"
};

let contract_pricelist = config.contract_pricelist;

//let MAX_SUPPLY = BigInt('18446744073709551615');
let MAX_SUPPLY_LIMIT = BigInt('18446744073709551615');
let MAX_DECIMALS = BigInt(10);
let ENQ_INTEGER_COIN = BigInt(10000000000);

function toHex(d) {
    let hex = Number(d).toString(16);
    while ((hex.length % 2) !== 0) {
        hex = "0" + hex;
    }
    return hex;
}
function sizeMarker(size) {
    let markerSize = 0xFFFF; // Max chunk size
    if(size > markerSize)
        throw new OutOfRangeError(`Size can't be bigger than ${markerSize}`);
    let marker = toHex(size);
    while (marker.length < 4) {
        marker = "0" + marker;
    }
    return marker;
}
// TODO: possible false-positive results because of data field format
function isContract(raw) {
    if(raw === undefined || raw === null)
        return false;
    let chunk = getChunk(raw);
    if((chunk.size === raw.length) && contract_pricelist.hasOwnProperty(chunk.key))
        return chunk.key;
    return false;
}
function getkey(object, value) {
    return Object.keys(object).find(key => object[key] === value);
}
function getChunk(bin){
    let size = parseInt(bin.substring(0, 4), 16);
    let key = getkey(schema, bin.substring(4,8));
    return {
        size : size,
        key : key,
        data : bin.substr(8, size - 8)
    }
}
function dataFromObject(obj){
    let res = {
        parameters : []
    };
    for(let param in obj.parameters){

        let type = undefined;
        switch (typeof obj.parameters[param]){
            case "bigint" : {
                type = "bigint";
                break;
            }
            case "string" : {
                type = "string";
                break;
            }
            default : type = "int";
        }
        //let type = (typeof obj.parameters[param] === "string") ? "string" : "int";
        res.parameters.push({key : param, [type] : obj.parameters[param]})
    }
    return serialize_object({
        [obj.type] : res
    });
}
function serialize_object(obj){
    let binary = "";
    if((!(Array.isArray(obj))) && (typeof obj !== "object"))
        return obj.toString();

    if(Array.isArray(obj)){
        for (let el of obj){
            let res = serialize_object(el);
            binary += res;
        }
    }
    else {
        for (let key in obj) {
            let code = schema[key];
            let res = serialize_object(obj[key]);
            binary += sizeMarker(res.length + 8) + code + res;
        }
    }
    return binary;
}
function deserialize(bin){
    let arr = [];
    while(bin.length > 0){
        let chunk = getChunk(bin);
        if(bin.length === chunk.size){
            if((!contract_pricelist.hasOwnProperty(chunk.key))
                && (chunk.key !== "parameters")
                && (chunk.key !== "object")){
                arr.push([chunk.key, chunk.data]);
                return arr;
            }
            bin = bin.substring(8, bin.length);
        }
        if(bin.length > chunk.size)
            arr.push([chunk.key, chunk.data]);
        else
            arr.push([chunk.key, deserialize(chunk.data)]);
        bin = bin.substring(chunk.size);
    }
    return arr;
}
function prettify(data){
    let res = {};
    let arr = [];
    for(let i = 0; i < (data.length); i++){
        let el = data[i];
        if(Array.isArray(el)){
            arr.push(prettify(el))
        }
        else{
            if(!Array.isArray(data[i+1])){
                res[el] = data[i+1];
                i++;
            }
            else{
                res[el] = prettify(data[i+1]);
                i++;
            }
        }
    }
    if(arr.length > 0)
        return arr;
    return res;
}
function parse(raw){
    let data = {};
    let input = (deserialize(raw))[0];
    data.type = input[0];
    input = prettify(input[1]);
    //data.procedure_name = input[0].procedure_name;
    let params = input[0].parameters;
    data.parameters = {};
    for(let i = 0; i < params.length; i+=2){
        let value = (Object.keys(params[i+1]))[0];
        if(value === "int" || value === "bigint" || value === "float"){
            if(value === "bigint"){
                value = BigInt(params[i+1][value]);
            }
            else {
                if(isNaN(params[i+1][value]))
                    throw new Error("Not a number");
                value = parseInt(params[i+1][value]);
            }
        }
        else
            value = params[i+1][value];
        data.parameters[params[i].key] = value;
    }
    return data;
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
    async execute(tx, db) {
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        // Check token exist
        let existing = await db.get_tickers_all();
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
        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : tok_data.total_supply,
                    token_hash : tx.hash,
                }
            ],
            pos_changes : [],
            post_action : [this.sqlInsertToken(tok_data)],
            token_info : {
                hash : tx.hash,
                ticker : params.ticker
            }
        };
    }
    sqlInsertToken(data) {
        return super.mysql.format(`INSERT INTO tokens SET ?`, [data])
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
    async execute(tx, db) {
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        if(params.name){
            let existing = await db.get_pos_names();
            if (existing.some(d => d.name === params.name))
                throw new ContractError(`Contract with name ${params.name} already exist`);
        }

        let pos_data = {
            id : tx.hash,
            owner : tx.from,
            fee : params.fee,
            name : params.name || null
        };

        return {
            amount_changes : [],
            pos_changes : [],
            post_action : [this.sqlInsertPos(pos_data)]
        };
    }
    sqlInsertPos(data) {
        return super.mysql.format(`INSERT INTO poses SET ?`, [data])
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
    async execute(tx, db) {
        /**
         * check pos_id exist
         * change tx.from balance = balance - amount
         * put row in pos_leases table, increase amount
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        // Check pos contract exist
        let existing = await db.get_pos_contract_all();
        if (!existing.some(d => d.id === params.pos_id))
            throw new ContractError(`POS contract ${params.pos_id} doesn't exist`);
        let lend_data = {
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : params.amount
        };

        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : BigInt(-1) * BigInt(params.amount),
                    token_hash : tx.ticker,
                }
            ],
            pos_changes : [
                {
                    pos_id : params.pos_id,
                    delegator : tx.from,
                    delegated : params.amount,
                    undelegated : BigInt(0),
                    reward : BigInt(0)
                }
            ],
            post_action : [this.sqlInsertDelegates(lend_data)]
        };
    }
    sqlInsertDelegates(data) {
        return super.mysql.format(`INSERT INTO delegates (pos_id, delegator, amount) VALUES (?)
        ON DUPLICATE KEY UPDATE amount = amount + VALUES(amount)`, [[data.pos_id, data.delegator, data.amount]])
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
    async execute(tx, db, kblock) {
        /**
         * get lend row from delegates table
         * check amount <= delegated amount
         * decrease delegated amount
         * put ertry to undelegates table
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        let leased = (await db.get_pos_delegates(params.pos_id, [tx.from]))[0];
        if(!leased)
            throw new ContractError("pos_id not found");
        if(params.amount > leased.amount)
            throw new ContractError("Unbond amount is bigger than leased amount");

        // Amount will be deducted from current DB value in finalize_macroblock
        let delegates_data = {
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(-1) *  BigInt(params.amount),
        };

        let undelegates_data = {
            id : tx.hash,
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : params.amount,
            height : kblock.n
        };

        return {
            amount_changes : [],
            pos_changes : [
                {
                    pos_id : params.pos_id,
                    delegator : tx.from,
                    delegated : BigInt(-1) *  BigInt(params.amount),
                    undelegated : params.amount,
                    reward : BigInt(0)
                }
            ],
            post_action : [
                this.sqlUpdateDelegates(delegates_data),
                this.sqlInsertUndelegates(undelegates_data)
            ]
        };
    }
    sqlUpdateDelegates(data) {
        // TODO: CAST(? AS UNSIGNED INTEGER)
        return super.mysql.format(`UPDATE delegates SET amount = amount + ? WHERE pos_id = ? AND delegator = ?`,
            [data.amount, data.pos_id, data.delegator])
    }
    sqlInsertUndelegates(data) {
        return super.mysql.format(`INSERT INTO undelegates (id, pos_id, amount, height) VALUES (?)`,
            [[data.id, data.pos_id, data.amount, data.height]])
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
    async execute(tx, db, kblock) {
        /**
         * get undelegated from undelegates table by undelegated_id
         * check TRANSFER_LOCK time
         * update pos_transits
         * return new balance
         */
        if(this.data.type === undefined)
            return null;

        let params = this.data.parameters;

        let transfer = (await db.get_pos_undelegates(params.undelegate_id))[0];
        let und_tx = (await db.get_tx(params.undelegate_id))[0];
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
        if(transfer.amount === 0)
            throw new ContractError("Transfer has already been processed");
        if(!this.checkTime(transfer, db.app_config.transfer_lock, kblock))
            throw new ContractError("Freeze time has not passed yet");

        let data = {
            id : params.undelegate_id,
            amount : BigInt(0)
        };
        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : transfer.amount,
                    token_hash : tx.ticker,
                }
            ],
            pos_changes : [
                {
                    pos_id : transfer.pos_id,
                    delegator : tx.from,
                    delegated : BigInt(0),
                    undelegated : BigInt(0),
                    transfer : params.undelegate_id,
                    reward : BigInt(0)
                }
            ],
            post_action : [this.sqlUpdateUndelegates(data)]
        };
    }

    checkTime(transfer, transfer_lock, kblock){
        if(kblock.n < config.FORKS.fork_block_001){
            console.info(`Transfer contract before ${config.FORKS.fork_block_001} block, rejected`);
            return false;
        }
        else return (BigInt(kblock.n) - BigInt(transfer.height)) >= BigInt(transfer_lock);
    }
    sqlUpdateUndelegates(data) {
        return super.mysql.format(`UPDATE undelegates SET amount = ? WHERE id = ?`, [data.amount, data.id])
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
    async execute(tx, db) {
        /**
         * check pos exist
         * get delegator's reward
         * change delegator's ledger amount
         * set delegator's reward to 0
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;
        let leased = (await db.get_pos_delegates(params.pos_id, [tx.from]))[0];
        if(!leased)
            throw new ContractError("Delegate not found");
        if(leased.reward <=  BigInt(0))
            throw new ContractError(`Delegator ${tx.from} has no reward on contract ${params.pos_id}`);

        let data = {
            pos_id : params.pos_id,
            delegator : tx.from,
            amount : BigInt(-1) *  BigInt(leased.reward)
        };

        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : leased.reward,
                    token_hash : tx.ticker,
                }
            ],
            pos_changes : [
                {
                    pos_id : params.pos_id,
                    delegator : tx.from,
                    delegated : BigInt(0),
                    undelegated : BigInt(0),
                    reward : BigInt(-1) *  BigInt(leased.reward)
                }
            ],
            post_action : [this.sqlUpdateDelegatesReward(data)]
        };
    }
    sqlUpdateDelegatesReward(data) {
        // TODO: CAST(? AS UNSIGNED INTEGER)
        return super.mysql.format(`UPDATE delegates SET reward = reward + ? WHERE pos_id = ? AND delegator = ?`,
            [data.amount, data.pos_id, data.delegator])
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
    async execute(tx, db) {
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
        let token_info = (await db.get_tokens_all(params.token_hash))[0];
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

        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : params.amount,
                    token_hash : params.token_hash,
                }
            ],
            pos_changes : [],
            post_action : [this.sqlUpdateTokensSupply(data)]
        };
    }
    sqlUpdateTokensSupply(data) {
        return super.mysql.format(`UPDATE tokens SET total_supply = total_supply + CAST(? AS UNSIGNED INTEGER) WHERE hash = ?`,
            [data.mint_amount, data.token_hash])
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
    async execute(tx, db) {
        /**
         * check token exist
         * check token reissuable
         * check token owner
         * chech new amount > 0
         * update tokens table total_supply = total_supply - amount
         * update token owner's ledger amount
         */
        if(this.data.type === undefined)
            return null;
        let params = this.data.parameters;
        let token_info = (await db.get_tokens_all(params.token_hash))[0];
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

        return {
            amount_changes : [
                {
                    id : tx.from,
                    amount_change : BigInt(-1) * params.amount,
                    token_hash : params.token_hash,
                }
            ],
            pos_changes : [],
            post_action : [this.sqlUpdateTokensSupply(data)],
            token_info : {
                hash : params.token_hash,
                db_supply : token_info.total_supply,
                supply_change :  BigInt(-1) * params.amount
            }
        };
    }
    sqlUpdateTokensSupply(data) {
        return super.mysql.format(`UPDATE tokens SET total_supply = total_supply - CAST(? AS UNSIGNED INTEGER) WHERE hash = ?`,
            [data.burn_amount, data.token_hash])
    }
}
module.exports.toHex = toHex;
module.exports.parse = parse;
module.exports.processData = processData;
module.exports.serialize_object = serialize_object;
module.exports.deserialize = deserialize;
module.exports.prettify = prettify;
module.exports.isContract = isContract;
module.exports.dataFromObject = dataFromObject;
module.exports.sizeMarker = sizeMarker;
module.exports.validate = validate;
module.exports.contract_pricelist = contract_pricelist;
module.exports.Contract = Contract;