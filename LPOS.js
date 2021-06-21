const enq = require('./Enq');
const crypto = require('crypto');
const Utils = require('./Utils');
const Transport = require('./Transport').Tip;


class LPOS {
    constructor(config, db) {
        this.db = db;
        this.config = config;
        this.ECC = new Utils.ECC(config.ecc.ecc_mode);
        this.current_merkle_root = undefined;
        //init transport
        this.transport = new Transport(this.config.id, 'pos');
        if (this.config.pos_share) {
            this.transport.on('emit_statblock', this.on_emit_statblock.bind(this));
            this.timer_resend_sblock = setTimeout(this.resend_sblock.bind(this), Utils.POS_MINER_RESEND_INTERVAL);
        } else {
            console.info(`PoS share not specified, PoS is OFF`)
        }
    }

    async resend_sblock() {
        try {
            clearTimeout(this.timer_resend_sblock);
            let tail = await this.db.peek_tail();
            let kblocks_hash = tail.hash;
            console.debug(`re-broadcast sblock for kblock ${kblocks_hash}`);
            let sblocks = await this.db.get_statblocks(kblocks_hash);
            if (sblocks.length > 0) {
                this.transport.broadcast("statblocks", sblocks);
            } else {
                console.warn(`no found statblocks`);
                this.on_emit_statblock({data: kblocks_hash});
                return;
            }
        } catch (e) {
            console.error(e);
        } finally {
            this.timer_resend_sblock = setTimeout(this.resend_sblock.bind(this), Utils.POS_MINER_RESEND_INTERVAL);
        }
    }

    async on_emit_statblock(msg) {
        try{
            let kblocks_hash = msg.data;
            console.silly('on_emit_statblock kblocks_hash ', kblocks_hash);

            let bulletin = "not_implemented_yet";
            let publisher = this.config.id;
            let sign = "";
            let sblock = {kblocks_hash, publisher, sign, bulletin};
            sblock.hash = Utils.hash_sblock(sblock).toString('hex');
            let time = process.hrtime();
            let result = await this.db.put_statblocks([sblock]);
            let put_time = process.hrtime(time);
            console.debug(`putting sblock time = ${Utils.format_time(put_time)} | result = ${result}`);
            if (result) {
                console.debug(`broadcast sblock for kblock ${kblocks_hash}`);
                this.transport.broadcast("statblocks", [sblock]);
            } else
                console.warn(`not insert sblock`);
        } catch (e) {
            console.error(e);
        }
    }
}

module.exports = LPOS;