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

const c0 = require('./contracts_000');
const c1 = require('./contracts_001');
const c2 = require('./contracts_002');
const Utils = require('./Utils');
const {ContractError} = require('./errors');
const ContractParser = require('./contractParser').ContractParser;

class ContractFactory{
    constructor(config) {
        this.parser = new ContractParser(config);
        this.config = config
    }
    createContract(raw, n = Utils.MAX_SUPPLY_LIMIT){
        let type = this.parser.isContract(raw);
        let data = this.parser.parse(raw);
        let Contracts = [c0, c1, c2];
        let fork_keys = Object.keys(this.config.FORKS);
        let idx = fork_keys.length - 1;
        for(let i = 0; i < fork_keys.length; i++){
            if(this.config.FORKS[fork_keys[i]] > n)
                break;
            idx = i;
        }
        switch(type) {
            case "create_token" :   return new Contracts[idx].CreateTokenContract(data);
            case "create_pos" :     return new Contracts[idx].CreatePosContract(data);
            case "delegate" :       return new Contracts[idx].DelegateContract(data);
            case "undelegate" :     return new Contracts[idx].UndelegateContract(data);
            case "transfer" :       return new Contracts[idx].TransferContract(data);
            case "pos_reward" :     return new Contracts[idx].PosRewardContract(data);
            case "mint" :           return new Contracts[idx].MintTokenContract(data);
            case "burn" :           return new Contracts[idx].BurnTokenContract(data);
            case "create_pool" :    return new Contracts[idx].DexPoolCreateContract(data);
            case "add_liquidity" :  return new Contracts[idx].DexLiquidityAddContract(data);
            case "remove_liquidity":return new Contracts[idx].DexLiquidityRemoveContract(data);
            case "swap" :           return new Contracts[idx].DexLiquiditySwapContract(data);
            default :               return null;
        }
    }
    async processData(tx, db, kblock){
        let contract = this.createContract(tx.data, kblock.n);
        if(!contract)
            return false;
        if(tx.amount < BigInt(this.config.contract_pricelist[contract.type])){
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

    validate(raw){
        let contract = this.createContract(raw);
        if(!contract)
            return false;
        return contract.validate();
    }

    create(tx, db){
        let contract = this.createContract(tx.data);
        if(!contract)
            return false;
        if(tx.amount < BigInt(this.config.contract_pricelist[contract.type])){
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
    isContract(raw) {
        return this.parser.isContract(raw);
    }
    parse(raw){
        return this.parser.parse(raw);
    }
}

module.exports.getContractMachine = function(forks, n){
    return n > forks.fork_block_002 ? c2 : c0;
};
module.exports.ContractFactory = ContractFactory;