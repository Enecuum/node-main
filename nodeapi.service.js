/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * nodeapi.service.js
 * Nodeapi module business logic
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');
const Pending = require('./Pending');

class NodeapiService {
    constructor(db) {
        this.db = db;
        this.pending = new Pending(this.db);
    }
    async post_tx(tx){
        let isValid = this.pending.validate(tx);
        if(isValid.err !== 0)
            return isValid;
        tx.from = tx.from.toLowerCase();
        tx.to = tx.to.toLowerCase();
        tx.hash = Utils.get_txhash(tx);

        let isExist = await this.db.pending_check(tx.hash);
        if(isExist){
            console.trace(`TX ${tx.hash} is already in txpool`);
            return {err: 1, message : "TX is already in txpool"};
        }
        // TODO: check insertion
        let result = await this.db.pending_add([tx]);
        return {err: 0, result : [{hash: tx.hash, status: 0}]};
    }
    async check_pending(msg) {
        return await this.db.get_pending();
    };
}
module.exports.NodeapiService = NodeapiService;