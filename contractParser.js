let schema = {
    "root" :                    "0000",
    "custom" :                  "0100",
    "create_token" :            "0200",
    "delegate" :                "0300",
    "undelegate" :              "0400",
    "signature" :               "0500",
    "hash" :                    "0600",
    "string" :                  "0700",
    "int" :                     "0800",
    "bigint" :                  "0900",
    "float" :                   "0a00",
    "object" :                  "0c00",
    "key" :                     "0d00",
    "procedure_name" :          "0e00",
    "parameters" :              "0f00",
    "create_pos" :              "1000",
    "pos_reward" :              "1100",
    "transfer" :                "1200",
    "mint" :                    "1300",
    "burn" :                    "1400",
    "pool_create" :             "1500",
    "pool_add_liquidity" :      "1600",
    "pool_remove_liquidity" :   "1700",
    "pool_sell_exact" :         "1800",
    "farm_create" :             "1900",
    "farm_get_reward" :         "1a00",
    "farm_increase_stake" :     "1b00",
    "farm_close_stake" :        "1c00",
    "farm_decrease_stake" :     "1d00",
    "farm_add_emission" :       "1e00",
    "dex_cmd_distribute" :      "1f00",
    "pool_sell_exact_routed" :  "2000",
    "pool_buy_exact" :          "2100",
    "pool_buy_exact_routed" :   "2200",
};
const contracts_000 = [
    "0100", "0200", "0300", "0400", "1000",
    "1100", "1200", "1300", "1400"
];
const contracts_002 = [
    "0100", "0200", "0300", "0400", "1000",
    "1100", "1200", "1300", "1400", "1500",
    "1600", "1700", "1800", "1900", "1a00",
    "1b00", "1c00", "1d00", "1e00", "1f00",
    "2000", "2100", "2200"
];
class ContractParser {
    constructor() {
        this.schema = schema;
        this.contracts = contracts_002;
    }
    toHex(d) {
        let hex = Number(d).toString(16);
        while ((hex.length % 2) !== 0) {
            hex = "0" + hex;
        }
        return hex;
    }
    sizeMarker(size) {
        let markerSize = 0xFFFF; // Max chunk size
        if(size > markerSize)
            throw new Error(`Size can't be bigger than ${markerSize}`);
        let marker = this.toHex(size);
        while (marker.length < 4) {
            marker = "0" + marker;
        }
        return marker;
    }
    getChunk(bin){
        let size = parseInt(bin.substring(0, 4), 16);
        let code = bin.substring(4, 8);
        let key = this.getkey(this.schema, code);
        return {
            size : size,
            key : key,
            code : code,
            data : bin.substr(8, size - 8)
        }
    }
    getContractsId(forks, n){
        let Contracts = [contracts_000, contracts_000, contracts_002, contracts_002]; // first duplicate contracts_000 but fork_001 didn`t change the contracts list
        let fork_keys = Object.keys(forks);
        let idx = fork_keys.length - 1;
        for(let i = 0; i < fork_keys.length; i++){
            if(forks[fork_keys[i]] > n)
                break;
            idx = i;
        }
        return Contracts[idx];
    }
    // TODO: possible false-positive results because of data field format
    isContract(raw, FORKS, n) {
        let contracts = (FORKS === undefined || n === undefined) ? this.contracts : this.getContractsId(FORKS, n);
        if(raw === undefined || raw === null)
            return false;
        let chunk = this.getChunk(raw);
        if((chunk.size === raw.length) && contracts.includes(chunk.code))
            return chunk.key;
        return false;
    }
    getkey(object, value) {
        return Object.keys(object).find(key => object[key] === value);
    }

    dataFromObject(obj){
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
        return this.serialize_object({
            [obj.type] : res
        });
    }
    serialize_object(obj){
        let binary = "";
        if((!(Array.isArray(obj))) && (typeof obj !== "object"))
            return obj.toString();

        if(Array.isArray(obj)){
            for (let el of obj){
                let res = this.serialize_object(el);
                binary += res;
            }
        }
        else {
            for (let key in obj) {
                let code = this.schema[key];
                let res = this.serialize_object(obj[key]);
                binary += this.sizeMarker(res.length + 8) + code + res;
            }
        }
        return binary;
    }
    deserialize(bin){
        let arr = [];
        while(bin.length > 0){
            let chunk = this.getChunk(bin);
            if(bin.length === chunk.size){
                if((!this.contracts.includes(chunk.code))
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
                arr.push([chunk.key, this.deserialize(chunk.data)]);
            bin = bin.substring(chunk.size);
        }
        return arr;
    }
    prettify(data){
        let res = {};
        let arr = [];
        for(let i = 0; i < (data.length); i++){
            let el = data[i];
            if(Array.isArray(el)){
                arr.push(this.prettify(el))
            }
            else{
                if(!Array.isArray(data[i+1])){
                    res[el] = data[i+1];
                    i++;
                }
                else{
                    res[el] = this.prettify(data[i+1]);
                    i++;
                }
            }
        }
        if(arr.length > 0)
            return arr;
        return res;
    }
    parse(raw){
        let data = {};
        let input = (this.deserialize(raw))[0];
        data.type = input[0];
        input = this.prettify(input[1]);
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
}
module.exports.ContractParser = ContractParser;