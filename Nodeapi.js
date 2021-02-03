/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * nodeapi.service.js
 * Node service business logic
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Transport = require('./Transport').Tip;
const ExplorerService = require('./explorer.service').ExplorerService;
const NodeapiService = require('./nodeapi.service').NodeapiService;

class NodeAPI {
    constructor(config, db) {
        this.db = db;
        this.config = config;
        this.explorerService = new ExplorerService(this.db);
        this.nodeapiService = new NodeapiService(this.db);
        this.transport = new Transport(this.config.id, 'nodeAPI');

        if(config.enable_post_tx)
            this.transport.on('post_tx', this.on_post_tx.bind(this));
        this.transport.on('get_active_balance', this.on_get_active_balance.bind(this));
        this.transport.on('get_txpool', this.on_get_txpool.bind(this));
        this.transport.on('peek', this.on_peek.bind(this));
        this.transport.on('snapshot', this.on_get_snapshot.bind(this));
        this.transport.on('snapshot_chunk', this.on_get_snapshot_chunk.bind(this));
        this.transport.on('get_macroblock', this.on_get_macroblock.bind(this));
    }

    async on_post_tx(msg) {
        let tx = msg.data;
        let res = await this.nodeapiService.post_tx(tx);
        if(res.err === 0)
            this.transport.broadcast("post_tx", tx);
        return res;
    };
    // TODO: Call Explorer Service method instead
    async on_get_active_balance(msg) {
        let data = msg.data;
        let res = await this.db.get_balance_all(data.id);
        return res;
    };
    async on_get_txpool(msg) {
        return await this.db.get_pending();
    };
    async on_get_macroblock(msg) {
        let hash;
        if (msg.data) {
            hash = msg.data.hash;
        }
        console.debug(`on get_macroblock ${hash}`);
        if (hash) {
            let succ = (await this.db.get_kblock(hash))[0];
            console.trace(`succ = ${JSON.stringify(succ)}`);
            let pred = await this.db.get_macroblock(succ.link);
            return {candidate: succ, macroblock: pred};
        }
    };

    //returns: hash, size_bytes
    async on_get_snapshot(msg){
        let height;
        if (msg.data) {
            height = msg.data.height;
        }
        if(height) {
            let snapshot_info = await this.db.get_snapshot_before(height);
            console.debug(`on get_snapshot before height ${height}`);
            if (snapshot_info) {
                return snapshot_info;
            } else {
                console.warn(`Not found snapshot before ${height}`);
            }
        } else
            return undefined;
    };

    //returns: binary data
    async on_get_snapshot_chunk(msg) {
        let hash;
        let chunk_no;
        let chunk_size_bytes;
        if (msg.data) {
            hash = msg.data.hash;
            chunk_no = msg.data.chunk_no;
            chunk_size_bytes = msg.data.chunk_size_bytes;
        } else {
            console.warn(`get_snapshot_chunk - undefined msg.data`);
            return undefined;
        }
        console.debug(`on get_snapshot_chunk hash=${hash} chunk_no=${chunk_no} chunk_size_bytes=${chunk_size_bytes}`);
        let snapshot_chunk = await this.db.get_snapshot_chunk(hash, chunk_no, chunk_size_bytes);
        if (snapshot_chunk) {
            return snapshot_chunk;
        } else {
            console.warn(`Not found snapshot_chunk`);
        }
    };

    async on_peek(msg) {
        let min, max;
        if (msg.data) {
            min = msg.data.min;
            max = msg.data.max;
        }
        console.debug('on peek', min, max);
        if (min !== undefined) {
            if (max !== undefined) {
                let lim = min + Math.min(max - min, this.config.peek_limit - 1);
                return this.db.peek_range(min, lim);
            } else {
                return this.db.peek_range(min, min + this.config.peek_limit - 1)
            }
        } else {
            console.silly('peeking tail');
            return this.db.peek_tail();
        }
    };
}

module.exports.NodeAPI = NodeAPI;