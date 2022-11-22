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
        let type = this.parser.isContract(raw, this.config.FORKS, n);
        let data = this.parser.parse(raw);
        let Contracts = getContractMachine(this.config.FORKS, n);

        let ENX_TOKEN_HASH = "";
        if (this.config.FORKS.fork_block_003 < n)
            ENX_TOKEN_HASH = this.config.dex.DEX_ENX_TOKEN_HASH;

        switch(type) {
            case "create_token" :           return new Contracts.TokenCreateContract(data);
            case "create_pos" :             return new Contracts.PosCreateContract(data);
            case "delegate" :               return new Contracts.PosDelegateContract(data);
            case "undelegate" :             return new Contracts.PosUndelegateContract(data);
            case "transfer" :               return new Contracts.PosTransferContract(data);
            case "pos_reward" :             return new Contracts.PosGetRewardContract(data);
            case "mint" :                   return new Contracts.TokenMintContract(data);
            case "burn" :                   return new Contracts.TokenBurnContract(data);
            case "pool_create" :            return new Contracts.PoolCreateContract(data);
            case "pool_add_liquidity" :     return new Contracts.PoolLiquidityAddContract(data);
            case "pool_remove_liquidity":   return new Contracts.PoolLiquidityRemoveContract(data);
            case "pool_sell_exact" :        return new Contracts.PoolLiquiditySellExactContract(data, ENX_TOKEN_HASH);
            case "pool_buy_exact" :         return new Contracts.PoolLiquidityBuyExactContract(data, ENX_TOKEN_HASH);
            case "farm_create" :            return new Contracts.FarmCreateContract(data);
            case "farm_increase_stake" :    return new Contracts.FarmIncreaseStakeContract(data);
            case "farm_decrease_stake" :    return new Contracts.FarmDecreaseStakeContract(data);
            case "farm_close_stake" :       return new Contracts.FarmCloseStakeContract(data);
            case "farm_get_reward" :        return new Contracts.FarmGetRewardContract(data);
            case "farm_add_emission" :      return new Contracts.FarmsAddEmissionContract(data);
            case "dex_cmd_distribute" :     return new Contracts.DexCmdDistributeContract(data, ENX_TOKEN_HASH);
            case "pool_sell_exact_routed" : return new Contracts.PoolLiquiditySellExactRoutedContract(data);
            case "pool_buy_exact_routed" :  return new Contracts.PoolLiquidityBuyExactRoutedContract(data);
            default :                       return null;
        }
    }
    async processData(tx, db, kblock){
        let contract = this.create(tx, db, kblock);
        return contract.execute(tx, db, kblock);
    }

    validate(raw){
        let contract = this.createContract(raw);
        if(!contract)
            return false;
        return contract.validate();
    }

    create(tx, db, kblock){
        let contract = this.createContract(tx.data, kblock.n);
        if(!contract)
            return false;
        if(tx.amount < BigInt(contract.pricelist[contract.type])){
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
    isContract(raw, n) {
        return this.parser.isContract(raw, this.config.FORKS, n);
    }
    parse(raw){
        return this.parser.parse(raw);
    }
}
function getContractMachine(forks, n){
    //return n > forks.fork_block_002 ? c2 : c0;
    let Contracts = [c0, c1, c2, c2]; // last c2 for enx_fork 
    let fork_keys = Object.keys(forks);
    let idx = fork_keys.length - 1;
    for(let i = 0; i < fork_keys.length; i++){
        if(forks[fork_keys[i]] > n)
            break;
        idx = i;
    }
    return Contracts[idx];
}

// module.exports = {
//     getContractMachine,
//     ContractFactory
// };
module.exports.getContractMachine = getContractMachine;
module.exports.ContractFactory = ContractFactory;