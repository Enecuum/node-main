/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * explorer.service.js
 * Explorer service business logic
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');

class ExplorerService {

    constructor(db) {
        this.db = db;
    }

    async get_csup(){
        let res = (await this.get_stats(['csup']));
        return res.csup;
    }
    async get_tsup(){
        let tsup = BigInt((await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0].total_supply);
        return tsup.toString();
    }
    async get_msup(){
        let msup = BigInt((await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0].max_supply);
        return msup.toString();
    }
    async get_network_hashrate(){
        let res = (await this.get_stats(['network_hashrate']));
        return (res.network_hashrate).toString();
    }
    async get_stats(keys){
        let stats = await this.db.get_stats(keys);
        stats = stats.reduce((a,c) => {
            a[c.key] = c.value;
            return a;
        }, {});
        return stats;
    }
}

// This service provides data as a plain text values such as 338349685.9920000000
class ExplorerServicePlain extends ExplorerService {

    constructor(db) {
        super(db);
    }

    async get_csup(){
        let amount = await super.get_csup();
        return Utils.strToFloat(amount);
    }
    async get_tsup(){
        let tsup = await super.get_tsup();
        return Utils.strToFloat(tsup);
    }
    async get_msup(){
        let msup = await super.get_msup();
        return Utils.strToFloat(msup);
    }
    async get_network_hashrate(){
        let res = await super.get_network_hashrate();
        return res;
    }
}

module.exports.ExplorerService = ExplorerService;
module.exports.ExplorerServicePlain = ExplorerServicePlain;