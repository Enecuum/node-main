const enq = require('./Enq');
const crypto = require('crypto');
const Transport = require('./Transport').Tip;
const Utils = require('./Utils');


class LPOS {
    constructor(config, db) {
        this.db = db;
        this.config = config;
        this.ECC = new Utils.ECC(config.ecc.ecc_mode);
        this.current_merkle_root = undefined;
        //init transport
        this.transport = new Transport(this.config.id, 'pos');
        if (this.config.ecc[this.config.ecc.ecc_mode].msk) {
            this.transport.on('emit_m_root', this.on_emit_m_root.bind(this));
            this.timer_merkle_root = setTimeout(this.resend_m_root.bind(this), Utils.M_ROOT_RESEND_INTERVAL);
        }
        if (this.config.pos_share) {
            this.transport.on('emit_statblock', this.on_emit_statblock.bind(this));
            this.timer_resend_sblock = setTimeout(this.resend_sblock.bind(this), Utils.POS_MINER_RESEND_INTERVAL);
        } else {
            console.info(`PoS share not specified, PoS is OFF`)
        }
    }

    async resend_m_root() {
        try {
            clearTimeout(this.timer_merkle_root);
            let tail = await this.db.peek_tail();
            if (this.current_merkle_root === undefined || this.current_merkle_root.kblocks_hash !== tail.hash) {
                this.on_emit_m_root({data: "timer"});
                return;
            } else
                this.transport.broadcast('m_root', this.current_merkle_root);
        } catch (e) {
            console.warn(`Error 'resend_m_root': ${e.message}`);
        } finally {
            this.timer_merkle_root = setTimeout(this.resend_m_root.bind(this),  Utils.M_ROOT_RESEND_INTERVAL);
        }
    }

    async on_emit_m_root(msg) {
        try {
            console.info(`on_emit_m_root - ${msg.data}`);
            let tail = await this.db.peek_tail();
            let mblocks = await this.db.get_microblocks(tail.hash);
            let sblocks = await this.db.get_statblocks(tail.hash);
            let snapshot_hash = undefined;

            console.debug(`on_emit_m_root - ${msg.data}   sblocks - ${sblocks.length},   mblocks - ${mblocks.length}`);
            //check snapshot
            if (tail.n % this.config.snapshot_interval === 0) {
                snapshot_hash = await this.db.get_snapshot_hash(tail.hash);
                if (snapshot_hash === undefined) {
                    console.trace(`dosen\`t exist snapshot`);
                    return;
                }
            }
            if (mblocks.length === 0 || sblocks.length === 0 || Utils.exist_native_token_count(mblocks) === 0) {
                console.trace(`not a complete block. (mblocks count: ${mblocks.length}, sblocks count: ${sblocks.length})`);
                return;
            }
            let m_root = Utils.merkle_root_002(mblocks, sblocks, snapshot_hash);
            let msk = this.config.ecc[this.config.ecc.ecc_mode].msk;
            let leader_sign = Utils.leader_sign(this.config.leader_id, msk, tail.hash, m_root, this.ECC, this.config.ecc);

            console.info(`leader_sign ${JSON.stringify(leader_sign)}` );
            this.current_merkle_root = {
                kblocks_hash: tail.hash,
                snapshot_hash,
                m_root,
                leader_sign,
                mblocks,
                sblocks
            };
            this.transport.broadcast('m_root', this.current_merkle_root);
        } catch (e) {
            console.warn(`Error 'emit m_root': ${e.message}`);
        }
    }

    async resend_sblock() {
        try {
            clearTimeout(this.timer_resend_sblock);
            let tail = await this.db.peek_tail();
            let kblocks_hash = tail.hash;
            console.debug(`re-broadcast sblock for kblock ${kblocks_hash}`);
            let sblocks = await this.db.get_statblocks(kblocks_hash);
            let found = sblocks.some(s=> s.publisher === this.config.id);
            if (sblocks.length > 0 && found) {
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