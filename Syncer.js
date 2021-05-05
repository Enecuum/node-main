/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Syncer.js
 * Module for synchronization with other nodes
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');
const Transport = require('./Transport').Tip;
const fs = require('fs');
let rx = require('./node_modules/node-randomx/addon');

const SYNCER_INTERVAL = 100;
const CONFIG_FILENAME = 'config.json';
const PK_FILENAME = 'id.pk';
const MAX_COUNT_INVALID_CANDIDATE = 10;


class Syncer {
	constructor(config, db) {
		this.db = db;
		this.config = config;
		if (config.port === undefined) {
			console.warn(`Port is undefined - Syncer is OFF`);
			return;
		}
		this.ECC = new Utils.ECC(config.ecc.ecc_mode);
		this.init_id(config);
		this.count_invalid_candidate = 0;
		//TODO: reinit VM (change key), this fix etimeout starting DB
		this.start_syncer(config.randomx.key);
		this.peers = [];
		//this.native_mblocks_count = this.config.mblock_slots.filter(s => s.token === Utils.ENQ_TOKEN_NAME)[0].count;
		this.native_mblocks_count = 1;
	}

	async start_syncer(key) {
		let res = await this.init_vm_randomx(key);
		console.info(`Virtual machine starting result: ${res}`);
		if (res === 0) {
			console.warn(`RandomX don't init. Syncer stopped`);
			return;
		}
		if(!(await this.check_database())){
			console.warn(`Database validation error. Syncer stopped`);
			return;
		}
		this.init_transport(this.config.load);
	}

	async check_database() {
		let tail = await this.db.peek_tail();
		if (tail === undefined) {
			try {
				await this.db.init_database();
			} catch (e) {
				console.error(e);
				return false;
			}
		}
		return true;
	}

	init_transport() {
		this.sync_running = false;
		this.on_candidate_busy = false;
		this.on_macroblock_busy = false;
		this.on_microblock_busy = false;
		this.on_statblock_busy = false;
		this.transport = new Transport(this.config.id, 'syncer');
		this.transport.on('macroblock', this.on_macroblock.bind(this));
		this.transport.on('microblocks', this.on_microblocks.bind(this));
		this.transport.on('statblocks', this.on_statblocks.bind(this));
		this.transport.on('tail', this.on_tail.bind(this));
		this.transport.on('new_peer', this.on_new_peer.bind(this));
	}

	async init_vm_randomx(key) {
		console.info(`Starting RandomX virtual machine. mode - ${this.config.randomx.mode}`);
		try {
			this.vm = await rx.RandomxVM(key, ["jit", "ssse3", this.config.randomx.mode]);
			return 1;
		} catch (e) {
			console.error(e);
			return 0;
		}
	}

	init_id(app_config) {
		let config_filename = app_config.config || CONFIG_FILENAME;
		let config = {};
		try {
			config = JSON.parse(fs.readFileSync(config_filename, 'utf8'));
		} catch (e) {
			console.info('No configuration file found.')
		}
		if (app_config.id == null) {
			if (app_config.auto_id === true) {
				console.warn("--id not specified");

				let key = Utils.genKeys();
				config.id = key.pubkey;
				app_config.id = key.pubkey;
				try {
					fs.writeFileSync(config_filename, JSON.stringify(config, null, 2), 'utf8');
				} catch (e) {
					console.error('Cannot save id to', config_filename);
					return;
				}
				try {
					fs.readFile(PK_FILENAME, function (err, data) {
						let json = [];
						if (data !== undefined) {
							json = JSON.parse(data);
						}
						json.push(key);

						fs.writeFileSync(PK_FILENAME, JSON.stringify(json), function (err) {
							if (err) throw err;
							console.info('The "key to append" was appended to file!');
						});
					});
				} catch (e) {
					console.error('Cannot save id_pk to', PK_FILENAME);
					return;
				}
			} else {
				console.fatal('Specify id to run Node !!!');
				return;
			}
		}
		console.info('node_id =', app_config.id);
	}

	async put_macroblock(candidate, mblocks, sblocks) {
		let result = false;
		let new_mblocks = await this.filter_new_mblocks(mblocks);
		if (new_mblocks.length > 0) {
			result = await this.db.put_microblocks(new_mblocks);
			if (!result) {
				console.warn('Mblocks is not inserted');
				return false;
			}
		}
		let new_sblocks = await this.filter_new_sblocks(sblocks);
		if (new_sblocks.length > 0) {
			result = await this.db.put_statblocks(new_sblocks);
			if (!result) {
				console.warn('Sblocks is not inserted. result:', result);
				return false;
			}
		}
		result = await this.db.finalize_macroblock(candidate, mblocks, sblocks);
		if (!result) {
			console.warn('Block is not inserted');
			return false;
		}
		return true;
	}

	async add_looped_macroblock(socket, n) {
		n = Number(n);
		console.debug(`load looped macroblock ${n}`);
		let exist = (await this.db.peek_range(n, n))[0];
		if (exist)
			return true;
		console.debug(`unicast 'peek' min: ${n} max: ${n + 1}`);
		let kblock_hash;
		let kblock = (await this.transport.unicast(socket, "peek", {min: n, max: n + 1}));
		if (kblock.length > 0 && kblock[0].hash === kblock[0].link) {
			kblock_hash = kblock[0].hash;
		} else if (kblock.length > 1 && kblock[0].hash === kblock[1].link) {
			kblock_hash = kblock[1].hash;
		} else {
			console.warn(`Incorrect response 'peek' min: ${n}, max: ${n + 1}). Sync aborted`);
			console.silly(`peek response: ${JSON.stringify(kblock)}`);
			return false;
		}
		let {candidate, macroblock} = await this.transport.unicast(socket, "get_macroblock", {hash: kblock_hash});
		let isValid_leader_sign = Utils.valid_leader_sign(macroblock.mblocks, this.config.leader_id, this.ECC, this.config.ecc);
		if (!isValid_leader_sign) {
			console.warn(`Invalid leader sign on mblocks`);
			return false;
		}
		try {
			macroblock.kblock.sprout = this.config.TRUNK;
			macroblock.kblock.hash = candidate.link;
			macroblock.kblock.link = candidate.link;
			let put_macroblock_result = await this.db.put_kblock(macroblock.kblock);
			if (!put_macroblock_result) {
				console.warn('Macroblock is not inserted. Sync aborted');
				return false;
			}
			let mblocks = await this.filter_new_mblocks(macroblock.mblocks);
			let result = await this.db.put_microblocks(mblocks);
			if (!result) {
				console.warn('Mblocks is not inserted');
				return false;
			}
		} catch (e) {
			console.warn(`Failed to put single macroblock in sync_chain (e) = ${e}`);
			return false;
		}
		return true;
	}

	async fastsync(tail, remote, socket) {
		let result = {status: false, tail: tail};
		console.silly(`fastsync: ${JSON.stringify(this.config.fastsync)}`);
		if ((remote.n - tail.n) > this.config.fastsync.lag_interval_b) {
			console.info(`Start FASTSYNC. Lag = ${remote.n - tail.n}`);
			let height = remote.n - this.config.fastsync.sync_interval_b;
			console.debug(`get snapshot before n = ${height}`);
			let remote_snapshot = await this.transport.unicast(socket, "snapshot", {height: height});
			if (remote_snapshot.hash === undefined) {
				console.warn(`Failed response snapshot before height ${height}`);
				return result;
			}
			console.debug(`response remote snapshot hash = ${remote_snapshot.hash}`);
			if (remote_snapshot.size === undefined) {
				console.warn(`Old format response from socket:${socket}`);
				return result;
			}
			//loading snapshot
			let snapshot = [];
			console.info(`loading snapshot ${remote_snapshot.hash}`);
			for (let i = 0; i < Math.ceil(remote_snapshot.size / Utils.SYNC_CHUNK_SIZE); i++) {
				let remote_chunk = undefined;
				for (let j = 0; j < this.config.downloading_try_count; j++) {
					console.info(`loading snapshot chunk ${i + 1}/${Math.ceil(remote_snapshot.size / Utils.SYNC_CHUNK_SIZE)}`);
					try {
						remote_chunk = await this.transport.unicast(socket, "snapshot_chunk", {
							hash: remote_snapshot.hash,
							chunk_no: i,
							chunk_size_bytes: Utils.SYNC_CHUNK_SIZE
						});
						if (remote_chunk !== undefined && remote_chunk.hash === remote_snapshot.hash)
							break;
					}catch(e){};
				}
				if (remote_chunk !== undefined && remote_chunk.hash === remote_snapshot.hash) {
					snapshot = snapshot.concat(remote_chunk.chunk.data);
				} else {
					console.warn(`Invalid chunk response. remote_chunk = ${JSON.stringify(remote_chunk)}`);
					return result;
				}
				console.debug(`loaded chunk ${i + 1}/${Math.ceil(remote_snapshot.size / Utils.SYNC_CHUNK_SIZE)}`);
			}
			//convert byte array to string
			let str = Buffer.from(snapshot).toString('utf8');
			//parse snapshot
			let snapshot_json = JSON.parse(str);
			snapshot_json.hash = remote_snapshot.hash;
			//putting kblocks with undelegate transactions
            let i = 0;
            let undelegates = snapshot_json.undelegates.filter(item => item.amount > 0);
			undelegates.sort((a,b) => (a.height > b.height) ? 1 : ((b.height > a.height) ? -1 : 0));
			for (let und of undelegates) {
				i++;
			    console.info(`loading und: ${i}/${undelegates.length}`);
				let und_height = Number(und.height);
				if (!und.delegator) {
					//get macroblock
					let res = false;
					for (let j = 0; j < this.config.downloading_try_count; j++) {
						if (await this.add_looped_macroblock(socket, und_height)){
							res = true;
							break;
						}
					}
					if(!res)
						return result;
					await this.db.set_status_undelegated_tx(und.id);
				}
			}
			//put macroblock
			let put_kblock_result = await this.add_looped_macroblock(socket, remote_snapshot.n);
			if (!put_kblock_result) {
				console.warn('Kblocks is not inserted. Sync aborted');
				return result;
			}
			//init snapshot
			let result_init = await this.db.init_snapshot(snapshot_json, true);
			if (!result_init) {
				console.warn(`Failed init snapshot ${remote_snapshot.hash} .Syncronization aborted`);
				return result;
			}
			result.tail = (await this.db.peek_range(remote_snapshot.n, remote_snapshot.n))[0];
			console.info(`FASTSYNC successfully init remote snapshot at block n = ${remote_snapshot.n}`);
		}
		result.status = true;
		return result;
	}

	check_peer(socket){
		let index = this.peers.findIndex(p => p.socket === socket);
		console.silly(`check_peer peers:${JSON.stringify(this.peers)}`);
		if(index >= 0) {
			let now = Date.now();
			if(this.peers[index].failures > Utils.SYNC_FAILURES_LIMIT){
				this.peers[index].ignore_timeout = now + Utils.SYNC_IGNORE_TIMEOUT;
				this.peers[index].failures = 0;
			}
			if(this.peers[index].ignore_timeout > 0) {
				if (now < this.peers[index].ignore_timeout) {
					return -1;
				} else {
					this.peers[index].ignore_timeout = 0;
				}
			}
		} else {
			return this.peers.push({socket:socket, ignore_timeout:0, failures:0}) - 1;
		}
		return index;
	}

	async sync_chain(socket) {
		let peer_index = this.check_peer(socket);
		if (peer_index < 0) {
			console.debug(`Peer ignore timeout ${socket}`);
			return;
		}
		if (this.sync_running) {
			console.debug('Another synchronization in progress');
			return;
		}
		/*
		if(this.on_macroblock_busy) {
			console.debug('sync_chain is blocked: on_macroblock_busy');
			return;
		}
		 */
		this.sync_running = true;
		await this.transport.selfcast("wait_sync", true);
		console.info('Synchronizing chain with', socket);
		try {
			let local;
			let tail = await this.db.peek_tail();
			let remote = await this.transport.unicast(socket, "peek");
			console.silly("remote tail", JSON.stringify(remote));
			if (!remote) {
				console.warn('Failed to get remote tail');
				this.peers[peer_index].failures++;
				return;
			}

			let local_chain_start = await this.db.get_chain_start_macroblock();
			let remote_chain_start = await this.transport.unicast(socket, "get_chain_start");
			let min = local_chain_start.n;
			let max = remote.n;
			if(this.config.hasOwnProperty('fastsync')) {
				//FASTSYNC
				let fastsync_result = await this.fastsync(tail, remote, socket);
				if (!fastsync_result.status) {
					setTimeout(this.sync_chain.bind(this), SYNCER_INTERVAL, socket);
					this.peers[peer_index].failures++;
					return;
				} else {
					if (tail.n !== fastsync_result.tail.n) {
						tail = fastsync_result.tail;
						min = fastsync_result.tail.n + 1;
						max = fastsync_result.tail.n + 1;
					} else if (remote_chain_start.n > min){
						min = remote_chain_start.n;
					}
				}
			} else {
                if (tail.n < remote_chain_start.n) {
                    console.warn(`Trying to synchronize with a 'fastsync' node with an invalid chain fragment. Syncronization aborted.`);
                    this.peers[peer_index].failures++;
                    return;
                } else {
                    min = remote_chain_start.n;
                }
            }
			//find fork
			while (min !== max) {
				let guess = ~~((min + max) * 0.5);
				console.trace(`min = ${min}, max = ${max}, guess = ${guess}`);

				remote = (await this.transport.unicast(socket, "peek", {min: guess, max: guess}));
				console.trace("remote", JSON.stringify(remote));
				if (Object.keys(remote).length === 0) {
					console.warn(`Empty remote response. Syncronization aborted.`);
					this.peers[peer_index].failures++;
					return;
				}
				local = (await this.db.peek_range(guess, guess));
				console.trace("local", JSON.stringify(local));

				if (Utils.coincidence(remote, local, this.vm, Utils.blocks_equal)) {
					//console.silly('hashes are equal');
					min = guess + 1;
				} else {
					//console.silly('hashes not equal');
					max = guess;
				}
			}
			let fork = min;
			console.debug('fork at', fork);

			//TODO: check if guess is correct (remote host can be cheating at previous stage)
			remote = (await this.transport.unicast(socket, "peek", {min: fork, max: fork}))[0];
			let remote_hash = Utils.hash_kblock(remote, this.vm);
			if (remote_hash === undefined) {
				console.warn(`Failed hash remote. fork = ${fork}`);
				this.peers[peer_index].failures++;
				return;
			}
			remote.hash = remote_hash.toString('hex');
			let fork_id = remote.hash;
			console.debug('fork_id = ', fork_id);

			//check needed resolve fork
			if (remote.link !== tail.hash) {
				console.silly(`remote.link !== tail.hash - ${remote.link !== tail.hash}`);
				console.silly(`remote = ${JSON.stringify(remote)},  tail = ${JSON.stringify(tail)}`);
				//check leader sign at fork block before removing chain tail
				let { macroblock } = await this.transport.unicast(socket, "get_macroblock", {hash: fork_id});
				if (macroblock === undefined) {
					console.warn(`Empty response 'get_macroblock'`);
					this.peers[peer_index].failures++;
					return;
				}
				let {kblock, mblocks} = macroblock;
				kblock.hash = (Utils.hash_kblock(kblock, this.vm)).toString('hex');
				if(local === undefined && local.length === 0 && local[0].link !== kblock.hash) {
					console.warn(`Invalid fork macroblock, 'link' field is not equal`);
					console.silly(` local.link - ${local[0].link}, kblocks.hash - ${kblock.hash}`);
					this.peers[peer_index].failures++;
					return;
				}
				let isValid_leader_sign = Utils.valid_leader_sign(mblocks, this.config.leader_id, this.ECC, this.config.ecc);
				if (!isValid_leader_sign) {
					console.warn(`Sync aborted. Invalid leader sign on mblocks`);
					this.peers[peer_index].failures++;
					return;
				}
				//Remove transactions, mblocks, sblocks, snapshots and kblocks before fork
				let result_delete = await this.db.delete_kblocks_after(fork - 1);
				if (!result_delete) {
					console.warn(`Failed to delete blocks after fork at ${fork} kblock .Syncronization aborted`);
					return;
				}
				//Reload from last snapshot before fork
				let snapshot_info = await this.db.get_snapshot_before(fork - 1);
				if(snapshot_info === undefined){
					console.error(`Not found snapshot before ${fork-1} block`);
					return;
				}
				let snapshot = await this.db.get_snapshot(snapshot_info.hash);
				if (snapshot === undefined || snapshot.length < 1) {
					console.error(`Not exist valid snapshot`);
					return;
				}
				let snapshot_json = '';
				try {
					snapshot_json = JSON.parse(snapshot.data);
					snapshot_json.hash = snapshot.hash;
				} catch (e) {
					console.error(`Invalid snapshot data. Not parsed JSON:`, e);
					return;
				}
				//Rollback calculation
				let result_rollback = await this.db.rollback_calculation(snapshot_info.n);
				if (!result_rollback) {
					console.warn(`Failed rollback calc to ${snapshot_info.n} kblock .Syncronization aborted`);
					return;
				}
				//Init snapshot
				let result_init = await this.db.init_snapshot(snapshot_json);
				if (!result_init) {
					console.warn(`Failed init snapshot ${snapshot.hash} .Syncronization aborted`);
					return;
				}
				tail = await this.db.peek_tail();
			}
			//single block sync
			let chunk;
			do {
				chunk = await this.transport.unicast(socket, "peek", {
					min: fork,
					max: fork + this.config.snapshot_interval - 1
				});
				for (let i = 0; i < chunk.length; i++) {
					let kblock_header = chunk[i];
					console.info(`processing block ${kblock_header.n}`);
					console.debug('processing block', JSON.stringify(kblock_header));
					kblock_header.hash = Utils.hash_kblock(kblock_header, this.vm).toString('hex');
					kblock_header.trunk = fork_id;

					let {candidate, macroblock} = await this.transport.unicast(socket, "get_macroblock", {hash: kblock_header.hash});
					if (candidate === undefined || macroblock === undefined) {
						console.warn(`Empty response 'get_macroblock'`);
						this.peers[peer_index].failures++;
						return;
					}
					let {kblock, mblocks, sblocks} = macroblock;
					let is_valid = await this.valid_candidate(candidate, mblocks, sblocks, kblock.n, tail);
					if (!is_valid) {
						console.warn(`Sync aborted. Chunk.kblocks start=${fork} lenght=${chunk.length} break i=${i}`);
						this.peers[peer_index].failures++;
						return;
					}
					try {
						let result = await this.put_macroblock(candidate, mblocks, sblocks);
						if (!result) {
							console.info('Failed to put macroblock. Syncronization aborted');
							return;
						} else {
							//TODO: tail cached
							tail = await this.db.peek_tail();
						}
					} catch (e) {
						console.warn(`Failed to put macroblock in sync_chain (e) = ${e}`);
						return;
					}
				}
				fork += chunk.length;
			} while (chunk.length > 0);
			console.info('Syncronization complete');
			this.peers[peer_index].failures = 0;
		} catch (e) {
			console.error('Syncronization aborted, error:', e);
		} finally {
			this.sync_running = false;
			await this.transport.selfcast("wait_sync", false);
		}
	};

	/*
	async on_vote(msg) {
		console.trace('on_vote ', JSON.stringify(msg.data));
		let sblock = msg.data;
		let tail = await this.db.peek_tail();
		//TODO:validation sblock
		if (sblock.hash_kblock !== tail.hash) {
			this.broadcast_cashed_macroblock(tail);
		}
		await this.put_doesnt_exist_sblocks([sblock]);

		this.transport.broadcast("statblocks", [sblock]);
	}*/

	async on_microblocks(msg) {
        if (this.sync_running) {
            console.trace('ignore on_microblocks event during synchronization');
            return;
        }
        if (this.on_microblock_busy) {
            console.trace('ignore on_microblocks event during the processing of the previous event');
            return;
        }
        this.on_microblock_busy = true;
        try {
            let time = process.hrtime();
            let mblocks = msg.data;
            console.silly('on_microblocks ', JSON.stringify(mblocks));
            if (!mblocks || mblocks.length === 0) {
                console.warn(`on_microblocks resive empty 'mblocks' object`);
                return;
            }
            mblocks = await this.filter_new_mblocks(mblocks);
            if (mblocks.length === 0) {
                console.debug(`on_microblocks: all microblocks already exist.`);
                return;
            }
            let accounts = await this.db.get_accounts_all(mblocks.map(m => m.publisher));
            let tokens = await this.db.get_tokens_all(mblocks.map(m => m.token));
            mblocks = Utils.valid_full_microblocks(mblocks, accounts, tokens, true);
            if (mblocks.length === 0) {
                console.warn(`on_microblocks: no valid microblocks found`);
                return;
            }
            let isValid_leader_sign = Utils.valid_leader_sign_000(mblocks, this.config.leader_id, this.ECC, this.config.ecc);
            if (!isValid_leader_sign) {
                console.warn(`on_microblocks: Invalid leader sign on mblocks`);
                return;
            }
            let validation_time = process.hrtime(time);
            time = process.hrtime();
            let result = await this.db.put_microblocks(mblocks);
            let put_time = process.hrtime(time);
            console.debug(`putting mblocks(${mblocks.length}) valid_time = ${Utils.format_time(validation_time)} | put_time = ${Utils.format_time(put_time)} | result = ${result}`);
            await this.transport.selfcast("emit_m_root");
        } catch (e) {
            console.error(e);
        } finally {
            this.on_microblock_busy = false;
        }
    }

	async filter_new_mblocks(mblocks) {
		let exists_microblocks = await this.db.get_exist_microblocks(mblocks.map(m => m.hash));
		return mblocks.filter(m => {
			return !exists_microblocks.find(element => element.hash === m.hash);
		});
	}

	async filter_new_sblocks(sblocks) {
		let exists_statblocks = await this.db.get_exist_statblocks(sblocks.map(s => s.hash));
		return sblocks.filter(s => {
			return !exists_statblocks.find(element => element.hash === s.hash);
		});
	}

	async on_statblocks(msg) {
        if (this.sync_running) {
            console.trace('ignore on_statblocks event during synchronization');
            return;
        }
        if (this.on_statblock_busy) {
            console.trace('ignore on_statblocks event during the processing of the previous event');
            return;
        }
        this.on_statblock_busy = true;
        try {
            let time = process.hrtime();
            let sblocks = msg.data;
            console.silly('on_statblocks ', JSON.stringify(sblocks));
            if (!sblocks || sblocks.length === 0) {
                console.warn(`on_statblocks resive empty 'sblocks' object`);
                return;
            }
            sblocks = await this.filter_new_sblocks(sblocks);
            if (sblocks.length === 0) {
                console.debug(`on_statblocks: all sblocks already exist.`);
                return;
            }
            // Validation sblocks
            let pos_stakes = await this.db.get_pos_info(sblocks.map(s => s.publisher));
            let pos_min_stake = this.config.pos_min_stake;
            let top_poses = await this.db.get_top_poses(this.config.top_poses_count);
            sblocks = Utils.valid_full_statblocks(sblocks, pos_stakes, pos_min_stake, top_poses);
            if (sblocks.length === 0) {
                console.warn(`on_statblocks: no valid statblocks found`);
                return;
            }
            let validation_time = process.hrtime(time);
            time = process.hrtime();
            let result = await this.db.put_statblocks(sblocks);
            let put_time = process.hrtime(time);
            console.debug(`putting sblocks(${sblocks.length}) valid_time = ${Utils.format_time(validation_time)} | put_time = ${Utils.format_time(put_time)} | result = ${result}`);
            await this.transport.selfcast("emit_m_root");
        } catch (e) {
            console.error(e);
        }
        finally {
            this.on_statblock_busy = false;
        }
    }

	async on_tail(msg) {
		console.silly(`on_tail msg = ${JSON.stringify(msg)}`);
		let kblock = msg.data;
		console.silly(`on_tail kblock = ${JSON.stringify(kblock)}`);
		let tail = await this.db.peek_tail();
		if (kblock.n > tail.n) {
			this.sync_chain([msg.host, msg.port].join(":"));
		}
	}

	async on_new_peer(msg) {
		console.info(`on new peer ${JSON.stringify(msg)}`);
		let tail = await this.db.peek_tail();
		this.transport.broadcast("tail", tail);
	}

	async valid_candidate(candidate, mblocks, sblocks, n, tail_kblock) {
		if (n !== tail_kblock.n) {
			console.debug(`Kblock N = ${n} not equal tail N = ${tail_kblock.n}`);
			return false;
		}
		// waiting for the cashier to calculate the previous block
		for (let i = 0; i < this.config.validation_try_count; i++) {
			let cashier_ptr = await this.db.get_cashier_pointer();
			if (candidate.link === cashier_ptr) {
				break;
			} else if (i === (this.config.validation_try_count - 1)) {
				console.warn(`Cashier lags behind. Validation could not be performed`);
				return false;
			} else {
				console.debug(`Validation wait cashier. step - ${i + 1}/${this.config.validation_try_count}`);
				await new Promise(r => setTimeout(r, 100));
			}
		}
		let now = new Date() / 1000;
		if (candidate.time < tail_kblock.time || candidate.time > now) {
			console.warn(`Incorrect candidate block time. Candidate time: ${candidate.time}, tail time: ${tail_kblock.time}, current time: ${now}`);
			return false;
		}
		if (mblocks.length === 0 || sblocks.length === 0) {
			console.warn(`Ignore empty candidate ${candidate.hash}`);
			return false;
		}
		let start = new Date().getTime();
		let accounts = await this.db.get_accounts_all(mblocks.map(m => m.publisher));
		let tokens = await this.db.get_tokens_all(mblocks.map(m => m.token));
		let valid_mblocks = Utils.valid_full_microblocks(mblocks, accounts, tokens, true);
		if (valid_mblocks.length !== mblocks.length) {
			console.warn(`Valid mblock count change: before ${mblocks.length}, after ${valid_mblocks.length}`);
			return false;
		}
		if (Utils.exist_native_token_count(valid_mblocks) < this.native_mblocks_count) {
			console.warn(`wrong candidte ${candidate.hash} , no native token mblocks found`);
			return false;
		}
		let end = new Date().getTime();
		console.debug(`validation full mblocks (size:${mblocks.length}) time: ${end - start}ms`);
		// Filter sblocks by exist contract and min stakes
		start = end;
		let pos_info = await this.db.get_pos_info(sblocks.map(s => s.publisher));
		let pos_min_stake = this.config.pos_min_stake;
		let top_poses = await this.db.get_top_poses(this.config.top_poses_count);
		let valid_sblocks = Utils.valid_full_statblocks(sblocks, pos_info, pos_min_stake, top_poses);
		end = new Date().getTime();
		console.debug(`validation sblocks (size:${valid_sblocks.length}) time: ${end - start}ms`);

		let snapshot_hash = undefined;
		//waiting for the cashier to generate a snapshot
		for (let i = 0; i < this.config.validation_try_count; i++) {
			snapshot_hash = await this.db.get_snapshot_hash(candidate.link);
			if (snapshot_hash === undefined && (n % this.config.snapshot_interval) === 0) {
				console.debug(`Validation missing snapshot on block ${candidate.hash}. step - ${i + 1}/${this.config.validation_try_count}`);
				await new Promise(r => setTimeout(r, 100));
			} else
				break;
		}
		let isValid_leader_sign = false;
		let recalc_m_root = undefined;
		if(n >= this.config.FORKS.fork_block_002) {
			recalc_m_root = Utils.merkle_root_002(valid_mblocks, valid_sblocks, snapshot_hash);
			isValid_leader_sign = Utils.valid_leader_sign(candidate.link, recalc_m_root, candidate.leader_sign, this.config.leader_id, this.ECC, this.config.ecc);
		} else {
			recalc_m_root = Utils.merkle_root_000(valid_mblocks, valid_sblocks, snapshot_hash);
			isValid_leader_sign = Utils.valid_leader_sign_000(valid_mblocks, this.config.leader_id, this.ECC, this.config.ecc);
		}
		if (!isValid_leader_sign) {
			console.warn(`Invalid leader sign`);
			return false;
		}

		if (candidate.m_root !== recalc_m_root) {
			console.warn(`After recalc block, changed m_root: before ${candidate.m_root}, after ${recalc_m_root}`);
			return false;
		}
		end = new Date().getTime();
		console.info(`recalc merkle_root time: ${end - start}ms`);
		start = end;
		let recalc_hash = Utils.hash_kblock(candidate, this.vm).toString('hex');
		if (candidate.hash !== recalc_hash) {
			console.warn(`After recalc kblock hash, chsnged hash: before ${candidate.hash}, after ${recalc_hash}`);
			return false;
		}
		end = new Date().getTime();
		console.debug(`recalc kblock hash time: ${end - start}ms`);
		start = end;
		let db = this.db;
		let current_diff = await Utils.calc_difficulty(db, this.config.target_speed, candidate);
		end = new Date().getTime();
		console.info(`recalc difficulty time: ${end - start}ms`);
		if (!Utils.difficulty_met(Buffer.from(candidate.hash, "hex"), current_diff)) {
			console.warn(`Difficulty macroblock is too low. Candidate diff = ${Utils.difficulty(Buffer.from(candidate.hash, "hex"))}, current diff = ${current_diff}`);
			return false;
		}
		return true;
	}

	async valid_header_candidate(candidate, mblocks, n, tail_n) {
		if (n !== tail_n) {
			console.warn(`Kblock N=${n} not equal tail N=${tail_n}`);
			return false;
		}
		let current_time = Math.floor(new Date() / 1000);
		if (candidate.time > current_time) {
			console.warn(`Candidte block time is greater than the current time of the leader pos. Candidte time: ${candidate.time}, current time: ${current_time}`);
			return false;
		}
		mblocks = Utils.valid_sign_microblocks(mblocks);
		candidate.m_root = Utils.merkle_root_000(mblocks);
		candidate.hash = Utils.hash_kblock(candidate, this.vm).toString('hex');
		//calc difficulty target
		//let candidate_diff = await Utils.calc_difficulty(candidate, this.config.difficulty);

		let db = this.db;
		let candidate_diff = await Utils.calc_difficulty(db, this.config.target_speed, candidate);
		if (!Utils.difficulty_met(candidate.hash, candidate_diff)) {
			console.warn(`Difficulty macroblock is too low`);
			return false;
		}
		return true;
	}

	async on_macroblock(msg) {
		console.debug(`on_macroblock`);
		//TODO: candidate queue
		if (this.sync_running) {
			console.trace('ignore on_macroblock event during synchronization');
			return;
		}
		if (this.on_macroblock_busy) {
			console.trace('ignore on_macroblock event during the processing of the previous event');
			return;
		}
		this.on_macroblock_busy = true;
		try {
			let {candidate, macroblock} = msg.data;
			let {kblock, mblocks, sblocks} = macroblock;
			console.trace('on_macroblock candidate', JSON.stringify(candidate));
			console.trace('on_macroblock macroblock', JSON.stringify(macroblock));
			let tail = await this.db.peek_tail();
			if (tail === undefined)
				return;
			console.trace('on_macroblock tail', JSON.stringify(tail));
			let is_valid = await this.valid_candidate(candidate, mblocks, sblocks, kblock.n, tail);
			if (is_valid) {
				console.silly('Appending block', JSON.stringify({candidate, mblocks, sblocks}));
				try {
					let result = await this.put_macroblock(candidate, mblocks, sblocks);
					if (!result) {
						console.warn('macroblock insert aborted');
						return;
					} else {
						let kblocks_hash = candidate.hash;
						await this.transport.selfcast("emit_statblock", kblocks_hash);
					}
				} catch (e) {
					console.warn(`Failed to put macroblock (e) = ${e}`);
				}
			} else {
				console.debug(`on macroblock invalid candidate ${candidate.hash}`);
				if (kblock.n > tail.n + 1) {
					this.sync_chain([msg.host, msg.port].join(":"));
				}
			}
		} catch (e) {
			console.error('on macroblock aborted, error:', e);
		} finally {
			this.on_macroblock_busy = false;
		}
	};

	on_snapshot(msg) {
		let {snapshot} = msg.data;
		console.trace(`on_snapshot`, snapshot);
		//TODO: Validation snapshot

		//TODO: Comparison local snapshot vs remote
	};
}

module.exports = Syncer;