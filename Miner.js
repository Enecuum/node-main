const Utils = require('./Utils');
const Transport = require('./Transport').Tip;
var rx = require('node-randomx/addon');

class Miner {
	constructor(config, db) {
		this.db = db;
		this.config = config;
		this.difficulty = config.difficulty;
		this.count_not_complete = 0;

		this.native_mblocks_count = 1;
		this.sync_ranning = false;
		if (config.port === undefined) {
			console.warn(`Port is undefined - Miner is OFF`);
			return;
		}

		this.ECC = new Utils.ECC(config.ecc.ecc_mode);

		//init transport
		this.transport = new Transport(this.config.id, 'miner_'+process.pid);
		this.transport.on('wait_sync', this.on_wait_sync.bind(this));
		this.transport.on('m_root', this.on_merkle_root.bind(this));

		//TODO: reinit VM (change key), this fix etimeout starting DB
		this.start_pow_miner(config.randomx.key);

	}

	async init_vm_randomx(key) {
		console.info(`Starting RandomX virtual machine. mode - ${this.config.randomx.mode}`);
		try {
			this.vm = await rx.RandomxVM(key, ["jit", "ssse3", "softAes", this.config.randomx.mode]);
			return 1;
		} catch (e) {
			console.error(e);
			return 0;
		}
	}

	async start_pow_miner(key) {
		let res = await this.init_vm_randomx(key);
		console.info(`Virtual mashine starting result: ${res}`);
		await this.miner();
	}

	async on_merkle_root(msg) {
		let {kblocks_hash, snapshot_hash, m_root, leader_sign, mblocks, sblocks} = msg.data;
		let tail = await this.db.peek_tail();
		if(tail.hash === kblocks_hash) {
			if(this.current_m_root === undefined || m_root !== this.current_m_root.m_root) {
				console.debug(`on_merkle_root kblock_hash = ${kblocks_hash}`);
				console.silly(`on_merkle_root msg ${JSON.stringify(msg.data)}`);
				//let is_valid = Utils.valid_merkle_root(m_root, mblocks, sblocks, snapshot_hash, leader_sign);
				let recalc_m_root = Utils.merkle_root_002(mblocks, sblocks, snapshot_hash);
				let isValid_leader_sign = Utils.valid_leader_sign_002(kblocks_hash, recalc_m_root, leader_sign, this.config.leader_id, this.ECC, this.config.ecc);
				console.debug({isValid_leader_sign});
				if (isValid_leader_sign)
					this.current_m_root = {m_root, kblocks_hash, mblocks, sblocks, snapshot_hash, leader_sign};
			} else
				console.debug(`on_merkle_root, this m_root has already been received`);
		} else
			console.debug(`on_merkle_root, kblocks_hash not equal tail.hash`);
	}

	on_wait_sync(msg) {
		this.sync_ranning = msg.data;
	}

	async broadcast_cashed_macroblock(tail) {
		if (this.cached_macroblock === undefined) {
			let macroblock = await this.db.get_macroblock(tail.link);
			this.cached_macroblock = {candidate: tail, macroblock};
		}
		console.trace(`Resending macroblock ${JSON.stringify(this.cached_macroblock)}`);
		this.transport.broadcast("macroblock", this.cached_macroblock);
	};

	async miner() {
		try {
			let tail = await this.db.peek_tail();
			if (tail === undefined) {
				setTimeout(this.miner, Utils.MINER_INTERVAL);
				return;
			}
			if (tail.n < this.config.FORKS.fork_block_002)
				this.miner_000(tail);
			else
				this.miner_002(tail);
		} catch (e) {
			console.error(e);
		} finally {
			setTimeout(this.miner.bind(this), Utils.MINER_INTERVAL);
		}
	}

	async miner_000(tail) {
		console.silly(`Miner started`);
		try {
			if (this.sync_ranning) {
				console.debug(`Miner not started. Sync running...`);
				return;
			}
			let start = new Date();
			if (tail === undefined) {
				console.debug(`tail is undefined. Mining stopped`);
				return;
			}

			let cashier_ptr = await this.db.get_cashier_pointer();
			if (tail.hash !== cashier_ptr) {
				console.debug(`Cashier lags behind. Mining stopped`);
				return;
			}

			let mblocks = await this.db.get_microblocks_full(tail.hash);
			let sblocks = await this.db.get_statblocks(tail.hash);

			let snapshot_hash = undefined;
			let need_snapshot = false;

			//TODO: remove old validation
			//check snapshot
			if (tail.n % this.config.snapshot_interval === 0) {
				snapshot_hash = await this.db.get_snapshot_hash(tail.hash);
				if (snapshot_hash === undefined) {
					console.trace(`dosen\`t exist snapshot`);
					need_snapshot = true;
				}
			}
			console.trace(`mblocks ${mblocks.length}, sblocks ${sblocks.length}, snapshot ${need_snapshot}`);
			// Filter mblocks by min stakes
			let accounts = await this.db.get_accounts_all(mblocks.map(m => m.publisher));
			let tokens = await this.db.get_tokens(mblocks.map(m => m.token));
			mblocks = Utils.valid_full_microblocks(mblocks, accounts, tokens, false);
			// Filter sblocks by min stakes
			let pos_stakes = await this.db.get_pos_info(sblocks.map(s => s.publisher));
			let pos_min_stake = this.config.pos_min_stake;
			let top_poses = await this.db.get_top_poses(this.config.top_poses_count);
			sblocks = Utils.valid_full_statblocks(sblocks, pos_stakes, pos_min_stake, top_poses);

			// Сhecking the content of the candidate
			if (mblocks.length > 0 && sblocks.length > 0 && !need_snapshot && Utils.exist_native_token_count(mblocks) >= this.native_mblocks_count) {
				this.count_not_complete = 0;
				let candidate = {
					time: Math.floor(new Date() / 1000),
					publisher: this.config.id,
					nonce: 0,
					link: tail.hash,
					m_root: Utils.merkle_root_000(mblocks, sblocks, snapshot_hash)
				};

				//calc difficulty target
				let db = this.db;
				let current_diff = await Utils.calc_difficulty(db, this.config.target_speed, tail);

				let now = new Date();
				let prev_calc = now - start;
				console.trace(`Previously calc time: ${prev_calc}`);
				start = now;

				let h;
				do {
					if (candidate.nonce % 10000 === 0) {
						now = new Date();
						let span = now - start;
						if (span >= 1000) {
							console.trace(`Miner not found hash in ${candidate.nonce} tries`);
							return;
						}
					}
					candidate.nonce++;
					h = Utils.hash_kblock(candidate, this.vm);
				} while (!Utils.difficulty_met(h, current_diff));

				candidate.hash = h.toString('hex');
				candidate.target_diff = current_diff;

				console.info(`Block ${candidate.hash} mined, ${candidate.link} terminated`);
				console.trace("Block mined ", JSON.stringify(candidate));
				let current_tail = await this.db.peek_tail();
				if (this.transport && tail.hash === current_tail.hash) {
					try {
						let time = process.hrtime();
						let result = await this.db.finalize_macroblock(candidate, mblocks, sblocks);
						let put_time = process.hrtime(time);
						if (!result) {
							console.warn('Block is not inserted');
						} else {
							console.debug(`macroblock ${candidate.hash} saved in `, Utils.format_time(put_time));
							//candidate.hash = undefined;
							//candidate.m_root = undefined;
							//TODO: здесь надо отправлять микроблоки без транзакций
							let macroblock = {kblock: tail};
							macroblock.mblocks = mblocks;
							macroblock.sblocks = sblocks;
							console.silly(`broadcasting macroblock ${JSON.stringify({candidate, macroblock})}`);
							this.cached_macroblock = {candidate, macroblock};
							this.transport.broadcast("macroblock", {candidate, macroblock});
						}
					} catch (e) {
						console.warn(`Failed to put candidate block (e) = ${e}`);
					}
				}
			} else {
				console.debug(`not a complete block ${tail.hash}, closing miner`);
				this.count_not_complete++;
				if (this.count_not_complete === Utils.MAX_COUNT_NOT_COMPLETE_BLOCK) {
					this.count_not_complete = 0;
					this.broadcast_cashed_macroblock(tail);
				}
			}
		} catch (e) {
			console.error(e);
		}
	}

	async miner_002(tail) {
		console.silly(`Miner started`);
		try {
			if (this.sync_ranning) {
				console.debug(`Miner not started. Sync running...`);
				return;
			}
			let start = new Date();
			if (tail === undefined) {
				console.debug(`tail is undefined. Mining stopped`);
				return;
			}

			if (this.current_m_root === undefined || tail.hash !== this.current_m_root.kblocks_hash) {
				if(this.current_m_root === undefined)
					console.debug(`m_root doesn't exist. Mining stopped`);
				else
					console.debug(`m_root doesn't exist for tail. Mining stopped`);
				this.count_not_complete++;
				if (this.count_not_complete === Utils.MAX_COUNT_NOT_COMPLETE_BLOCK) {
					this.count_not_complete = 0;
					this.broadcast_cashed_macroblock(tail);
				}
				return;
			}
			let cashier_ptr = await this.db.get_cashier_pointer();
			if (tail.hash !== cashier_ptr) {
				console.debug(`Cashier lags behind. Mining stopped`);
				return;
			}

			let mblocks = await this.db.get_microblocks_full(tail.hash);
			let sblocks = await this.db.get_statblocks(tail.hash);
			let m_root = this.current_m_root.m_root;
			let leader_sign = this.current_m_root.leader_sign;

			mblocks = mblocks.filter(m => this.current_m_root.mblocks.find(mm => mm.hash === m.hash));
			sblocks = sblocks.filter(s => this.current_m_root.sblocks.find(ss => ss.hash === s.hash));
			if (!(mblocks.length === this.current_m_root.mblocks.length && sblocks.length === this.current_m_root.sblocks.length)) {
				console.debug(`. Mining stopped`);
				return;
			}

			// Сhecking the content of the candidate
			if (mblocks.length > 0 && sblocks.length > 0 && Utils.exist_native_token_count(mblocks) >= this.native_mblocks_count) {
				this.count_not_complete = 0;
				let candidate = {
					time: Math.floor(new Date() / 1000),
					publisher: this.config.id,
					nonce: 0,
					link: tail.hash,
					m_root,
					leader_sign
				};

				//calc difficulty target
				let db = this.db;
				let current_diff = await Utils.calc_difficulty(db, this.config.target_speed, tail);

				let now = new Date();
				let prev_calc = now - start;
				console.trace(`Previously calc time: ${prev_calc}`);
				start = now;

				let h;
				let tries = 0;
				let span;
				do {
					if (tries % 5000 === 0) {
						now = new Date();
						span = now - start;
						if (span >= 1000) {
							console.info(`hashrate ${tries/(span/1000)}`);
							console.trace(`Miner not found hash in ${tries} tries`);
							return;
						}
					}
					tries++;
					candidate.nonce = Math.round(Math.random() * Utils.MAX_NONCE);
					h = Utils.hash_kblock(candidate, this.vm);
				} while (!Utils.difficulty_met(h, current_diff));
				span = new Date() - start;
				console.info(`hashrate ${tries/(span/1000)}`);

				candidate.hash = h.toString('hex');
				candidate.target_diff = current_diff;

				console.info(`Block ${candidate.hash} mined, ${candidate.link} terminated`);
				console.trace("Block mined ", JSON.stringify(candidate));
				let current_tail = await this.db.peek_tail();
				if (this.transport && tail.hash === current_tail.hash) {
					try {
						this.count_not_complete = 0;
						let time = process.hrtime();
						let result = await this.db.finalize_macroblock(candidate, mblocks, sblocks);
						let put_time = process.hrtime(time);
						if (!result) {
							console.warn('Block is not inserted');
						} else {
							console.debug(`macroblock ${candidate.hash} saved in `, Utils.format_time(put_time));
							//candidate.hash = undefined;
							//candidate.m_root = undefined;
							//TODO: здесь надо отправлять микроблоки без транзакций
							let macroblock = {kblock: tail};
							macroblock.mblocks = mblocks;
							macroblock.sblocks = sblocks;
							console.silly(`broadcasting macroblock ${JSON.stringify({candidate, macroblock})}`);
							this.cached_macroblock = {candidate, macroblock};
							this.transport.broadcast("macroblock", {candidate, macroblock});
						}
					} catch (e) {
						console.warn(`Failed to put candidate block (e) = ${e}`);
					}
				}
			} else {
				console.debug(`not a complete block ${tail.hash}, closing miner`);
				this.count_not_complete++;
				if (this.count_not_complete === Utils.MAX_COUNT_NOT_COMPLETE_BLOCK) {
					this.count_not_complete = 0;
					this.broadcast_cashed_macroblock(tail);
				}
			}
		} catch (e) {
			console.error(e);
		}
	}
}

module.exports = Miner;