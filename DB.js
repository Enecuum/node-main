/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * DB.js
 * Database access layer
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const mysql = require('mysql');
const Utils = require('./Utils');
const {DatabaseError} = require('./errors');

Object.defineProperty(Array.prototype, 'chunk', {
	value: function(chunkSize) {
		var R = [];
		for (var i = 0; i < this.length; i += chunkSize)
			R.push(this.slice(i, i + chunkSize));
		return R;
	}
});

class DB {

	constructor(config, app_config){
		app_config.ORIGIN.hash = app_config.TRUNK;
		app_config.ORIGIN.link = app_config.TRUNK;
		app_config.ORIGIN.sprout = app_config.TRUNK;
		app_config.ORIGIN.time = new Date(0) / 1000;

		this.TRUNK = app_config.TRUNK;
		this.ORIGIN = app_config.ORIGIN;
		this.config = config;
		this.app_config = app_config;
		this.last_tail = null;
		this.cached_tail = null;

		this.config.connectionLimit = 10;
		this.config.supportBigNumbers = true;
		this.config.waitForConnections = true;

		if(this.config.useNativeBigInt === false)
			this.config.useNativeBigInt = false;
		else
			this.config.useNativeBigInt = true;

		this.pool = mysql.createPool(this.config);

		this.pool.on('connection', function (connection) {
			console.debug(`Set DB connection psrams at threadId [${connection.threadId}]`);
			connection.query("SET sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))");
			connection.query("SET GLOBAL max_allowed_packet=134217728");
		});
	}

	connection() {
		return new Promise((resolve, reject) => {
			this.pool.getConnection((err, connection) => {
				if (err) reject(err);
				const query = (sql, binding) => {
					return new Promise((resolve, reject) => {
						console.silly(`[${connection.threadId}] ${sql}`);
						connection.query(sql, binding, (err, result) => {
							if (err) reject(err);
							resolve(result);
						});
					});
				};
				const release = () => {
					return new Promise((resolve, reject) => {
						if (err) reject(err);
						resolve(connection.release());
					});
				};
				resolve({connection, query, release});
			});
		});
	};

	async request(sql) {
		let connection = await this.connection();
		try {
			return await connection.query(sql);
		} catch (err) {
			console.error(`Database error: ${err}`);
		} finally {
			await connection.release();
		}
	};

	async transaction(sql) {
		let connection = await this.connection();
		try {
			await connection.query("START TRANSACTION");
			let querys = sql.split(';');
			for (let query of querys) {
				let r = query.trim();
				if (r !== '')
					await connection.query(r);
			}
			await connection.query("COMMIT");
			return true;
		} catch (err) {
			console.error(`Transaction error: ${err}`);
			if(connection.connection.state !== 'disconnected')
			  	await connection.query("ROLLBACK");
			return false;
		} finally {
			await connection.release();
		}
	}

	put_origin() {
		let sql = mysql.format(`INSERT INTO sprouts SET ?; INSERT INTO kblocks SET ?;`, [{sprout:this.TRUNK, fork:this.TRUNK, n:0, branch:this.TRUNK}, this.ORIGIN]);
		this.transaction(sql);
	};

	async init_snapshot(snapshot, save_snapshot) {
		let INSERT_CHUNK_SIZE = 100;
		try {
            console.info(`Setting snapshot: ${snapshot.hash}`);
            //let locs = mysql.format(`LOCK TABLES sprouts WRITE, kblocks WRITE, mblocks WRITE, sblocks WRITE, ledger WRITE, tokens WRITE, poses WRITE, delegates WRITE, undelegates WRITE, eindex WRITE, tokens_index WRITE, poalist WRITE, stat WRITE, snapshots WRITE`);
            let truncate = mysql.format(`
			TRUNCATE TABLE ledger;
			TRUNCATE TABLE tokens;
			TRUNCATE TABLE poses;
			TRUNCATE TABLE delegates;
			TRUNCATE TABLE undelegates;
			TRUNCATE TABLE tokens_index`);

            let sprouts = '';
			let kblock = '';
			if (snapshot.kblock) {
				sprouts = mysql.format(`INSERT INTO sprouts SET ?`, [{
					sprout: this.TRUNK,
					fork: this.TRUNK,
					n: snapshot.kblock.n,
					branch: this.TRUNK
				}]);
				kblock = mysql.format(`INSERT INTO kblocks SET ?`, [snapshot.kblock]);
			}
			let ledger = [];
			let ledger_chunks = snapshot.ledger.chunk(INSERT_CHUNK_SIZE);
			ledger_chunks.forEach(chunk => {
				ledger.push(mysql.format("INSERT INTO ledger (`id`, `amount`, `token`) VALUES ? ON DUPLICATE KEY UPDATE `amount` = VALUES(amount)", [chunk.map(a => [a.id, a.amount, a.token])]));
			});
			let tokens = [];
			let tokens_chunks = snapshot.tokens.chunk(INSERT_CHUNK_SIZE);
			tokens_chunks.forEach(chunk => {
				tokens.push(mysql.format("INSERT INTO tokens (hash, owner, fee_type, fee_value, fee_min, ticker, decimals, total_supply, max_supply, block_reward, min_stake, caption, referrer_stake, ref_share, reissuable, minable) VALUES ? ", [chunk.map(a => [a.hash, a.owner, a.fee_type, a.fee_value, a.fee_min, a.ticker, a.decimals, a.total_supply, a.max_supply, a.block_reward, a.min_stake, a.caption, a.referrer_stake, a.ref_share, a.reissuable, a.minable])]));
			});
			let tokens_index = [];
			if(snapshot.tokens_index) {
				let tokens_index_chunks = snapshot.tokens_index.chunk(INSERT_CHUNK_SIZE);
				tokens_index_chunks.forEach(chunk => {
					tokens_index.push(mysql.format("INSERT INTO tokens_index (hash, txs_count) VALUES ? ", [chunk.map(a => [a.hash, a.txs_count])]));
				});
			}
			let poses = [];
			if (snapshot.poses.length > 0) {
				let poses_chunks = snapshot.poses.chunk(INSERT_CHUNK_SIZE);
				poses_chunks.forEach(chunk => {
					poses.push(mysql.format("INSERT INTO poses (id, owner, fee, name) VALUES ? ", [chunk.map(pos => [pos.id, pos.owner, pos.fee, pos.name])]));
				});
			}
			let delegates = [];
			if (snapshot.delegates.length > 0) {
				let delegates_chunks = snapshot.delegates.chunk(INSERT_CHUNK_SIZE);
				delegates_chunks.forEach(chunk => {
					delegates.push(mysql.format("INSERT INTO delegates (pos_id, delegator, amount, reward) VALUES ? ", [chunk.map(del => [del.pos_id, del.delegator, del.amount, del.reward])]));
				});
			}
			let undelegates = [];
			if (snapshot.undelegates.length > 0) {
				let undelegates_chunks = snapshot.undelegates.chunk(INSERT_CHUNK_SIZE);
				undelegates_chunks.forEach(chunk => {
					undelegates.push(mysql.format("INSERT INTO undelegates (id, pos_id, amount, height) VALUES ? ", [chunk.map(undel => [undel.id, undel.pos_id, undel.amount, undel.height])]));
				});
			}
			let cashier_ptr = mysql.format("INSERT INTO stat (`key`, `value`) VALUES ('cashier_ptr', ?) ON DUPLICATE KEY UPDATE `value` = VALUES(value)", snapshot.kblocks_hash);
            //let unlock = mysql.format(`UNLOCK TABLES`);
			let sql_put_snapshot = "";
			if(save_snapshot){
				sql_put_snapshot = mysql.format("INSERT INTO snapshots SET ?", [{hash:snapshot.hash, kblocks_hash:snapshot.kblocks_hash, data:JSON.stringify(snapshot)}]);
			}

			return this.transaction([truncate, sprouts, kblock, sql_put_snapshot, ledger.join(';'), tokens.join(';'), tokens_index.join(';'), poses.join(';'), delegates.join(';'), undelegates.join(';'), cashier_ptr].join(';'));
        }catch (e) {
            console.error(e);
            return false;
        }
	};

	async rollback_calculation(height){
		let kblocks = await this.request(mysql.format('SELECT hash FROM kblocks WHERE n >= ?', [height]));
		let kblock_hashes = kblocks.map(k => k.hash);
		if (kblock_hashes.length > 0) {
			/*
			let mblocks = mysql.format(`UPDATE mblocks SET calculated = 0, indexed = 0 WHERE kblocks_hash in (SELECT hash FROM kblocks WHERE n >= ?) AND calculated = 1`,[height]);
			let sblocks = mysql.format(`UPDATE sblocks SET calculated = 0, indexed = 0 WHERE kblocks_hash in (SELECT hash FROM kblocks WHERE n >= ?) AND calculated = 1`,[height]);
			let mblocks_data = await this.request(mysql.format('SELECT hash FROM mblocks WHERE kblocks_hash in (SELECT hash FROM kblocks WHERE n >= ?)', [height]));
			let mblock_hashes = mblocks_data.map(m => m.hash);
			let transactions = '';
			if (mblock_hashes.length > 0)
				transactions = mysql.format(`UPDATE transactions SET status = null WHERE mblocks_hash in (SELECT hash FROM mblocks WHERE kblocks_hash in (SELECT hash FROM kblocks WHERE n >= ?) AND calculated = 1)`,[height]);
			return this.transaction([mblocks, sblocks, transactions].join(';'));
			*/
			let mblocks = [];
			let sblocks = [];
			let transactions = [];
			kblock_hashes.forEach(async hash => {
				mblocks.push(mysql.format(`UPDATE mblocks SET calculated = 0, indexed = 0 WHERE kblocks_hash = ? AND calculated = 1`,[hash]));
				sblocks.push(mysql.format(`UPDATE sblocks SET calculated = 0, indexed = 0 WHERE kblocks_hash = ? AND calculated = 1`,[hash]));
				let mblocks_data = await this.request(mysql.format('SELECT hash FROM mblocks WHERE kblocks_hash = ? AND calculated = 1', [hash]));
				let mblock_hashes = mblocks_data.map(m => m.hash);
				if (mblock_hashes.length > 0)
					transactions.push(mysql.format(`UPDATE transactions SET status = null WHERE mblocks_hash in (?)`,[mblock_hashes]));
			});
			return this.transaction([mblocks.join(';'), sblocks.join(';'), transactions.join(';')].join(';'));
		}
		return 0;
	};

	set_status_undelegated_tx(hash){
		console.debug("set status 3 for undelegated tx ", hash);
		let upd_mblock = mysql.format(`UPDATE mblocks SET included = 1 WHERE hash in (SELECT mblocks_hash FROM transactions WHERE hash = ?)`,[hash]);
		let upd_tx = mysql.format(`UPDATE transactions SET status = 3 WHERE hash = ?`,[hash]);

		return this.transaction([upd_mblock, upd_tx].join(';'));
	};

	async put_snapshot(snapshot, hash){
		console.debug("putting snapshot", hash);
		let exist_hash = await this.get_snapshot_hash(snapshot.kblocks_hash);
		if(exist_hash === hash)
			return true;
		return this.transaction(mysql.format("INSERT INTO snapshots SET ?", [{hash, kblocks_hash:snapshot.kblocks_hash, data:JSON.stringify(snapshot)}]));
	};

	put_kblock(block){
		console.debug("putting block", JSON.stringify(block));
		let sql = mysql.format(`INSERT INTO kblocks (hash, link, n, sprout, time, publisher, nonce, m_root, reward) VALUES (?)`, [[block.hash, block.link, block.n, block.sprout, block.time, block.publisher, block.nonce, block.m_root, block.reward]]);
		return this.transaction(sql);
	};

	async delete_kblocks_after(height) {
	    //block after which we delete the chain
        let kblock = await this.request(mysql.format('SELECT hash FROM kblocks WHERE n = ?', [height]));
        let fork_kblock_hash = kblock.map(k => k.hash);
        let kblocks = await this.request(mysql.format('SELECT hash FROM kblocks WHERE n > ? ORDER BY n DESC', [height]));
		let kblock_hashes_to_remove = kblocks.map(k => k.hash);
        let kblock_hashes = kblock_hashes_to_remove.concat(fork_kblock_hash);
        if (kblock_hashes.length > 0) {
			//let locs = mysql.format(`LOCK TABLES kblocks WRITE, mblocks WRITE, sblocks WRITE, snapshots WRITE, transactions WRITE, eindex WRITE`);
			let mblocks = await this.request(mysql.format('SELECT hash FROM mblocks WHERE kblocks_hash in (?)', [kblock_hashes]));
			let mblock_hashes = mblocks.map(m => m.hash);
			let delete_transactions = '';
			if (mblock_hashes.length > 0) {
				delete_transactions = mysql.format(`DELETE FROM transactions WHERE mblocks_hash in (?)`, [mblock_hashes]);
			}
			let delete_mblocks = mysql.format(`DELETE FROM mblocks WHERE kblocks_hash in (?)`, [kblock_hashes]);
			let delete_sblocks = mysql.format(`DELETE FROM sblocks WHERE kblocks_hash in (?)`, [kblock_hashes]);
			let delete_snapshots = mysql.format(`DELETE FROM snapshots WHERE kblocks_hash in (?)`, [kblock_hashes_to_remove]);
			let delete_kblocks = [];
            kblock_hashes_to_remove.forEach(function (item) {
				delete_kblocks.push(mysql.format('DELETE FROM kblocks WHERE hash = ?', item));
			});
			//TODO: delete eindex
			//let unlock = mysql.format(`UNLOCK TABLES`);
			console.debug(`Delete kblocks: ${kblock_hashes}, mblocks: ${mblock_hashes}`);
			return this.transaction([/*locs,*/ delete_transactions, delete_mblocks, delete_sblocks, delete_snapshots, delete_kblocks.join(';')/*, unlock*/].join(';'));
		}
		return 0;
	}

	delete_snapshot(hash){
		let sql = mysql.format(`DELETE FROM snapshots WHERE hash = ?`, hash);
		return this.request(sql);
	}

	async get_snapshot_hash(kblocks_hash){
		let snapshot_hash = undefined;
		let data = await this.request(mysql.format('SELECT hash FROM snapshots WHERE ? ORDER BY hash', [{kblocks_hash}]));
		if(data.length !== 0){
			snapshot_hash = data[0].hash;
		}
		return snapshot_hash;
	}

	async get_snapshot_before(height){
		/*return (await this.request(mysql.format(`SELECT n, snapshots.hash, snapshots.kblocks_hash, OCTET_LENGTH(snapshots.data) as size  FROM snapshots
										left join kblocks ON kblocks.hash = snapshots.kblocks_hash 
										where n < ?
										order by n desc 
										limit 1`, [height])))[0];*/
		let n = Math.floor(height/this.app_config.snapshot_interval)*this.app_config.snapshot_interval;
		return (await this.request(mysql.format(`SELECT CAST(? AS SIGNED) as n, snapshots.hash, snapshots.kblocks_hash, OCTET_LENGTH(snapshots.data) as size FROM snapshots
										where kblocks_hash = (select hash from kblocks where  n = ?)`, [n, n])))[0];
	}

	async get_snapshot(hash){
		return (await this.request(mysql.format(`SELECT snapshots.hash, snapshots.kblocks_hash, snapshots.data  FROM snapshots
										where snapshots.hash = ?`, [hash])))[0];
	}

	async get_snapshot_chunk(hash, chunk_no, byte_size){
		let start_pos = chunk_no * byte_size + 1;
		let sql = mysql.format(`SELECT snapshots.hash, SUBSTRING(snapshots.data, ?, ?) as chunk
								FROM trinity.snapshots
								where hash = ? limit 1;`, [start_pos, byte_size, hash]);
		return (await this.request(sql))[0];
	}

	get_included_microblocks(kblocks_hash){
		return this.request(mysql.format('SELECT * FROM mblocks WHERE ? AND included = 1 ORDER BY hash', [{kblocks_hash}]));
	}

	get_included_statblocks(kblocks_hash){
		return this.request(mysql.format('SELECT * FROM sblocks WHERE ? AND included = 1 ORDER BY hash', [{kblocks_hash}]));
	}

	get_microblocks(kblocks_hash){
		return this.request(mysql.format('SELECT * FROM mblocks WHERE ?', [{kblocks_hash}]));
	}

	get_statblocks(kblocks_hash){
		return this.request(mysql.format('SELECT * FROM sblocks WHERE ?', [{kblocks_hash}]));
	}

	async get_avg_diff_kblock(kblock_hash, target){
		let sql = mysql.format(`SELECT 
			FLOOR(AVG(target_diff)) AS avg_diff
			FROM kblocks 
			WHERE n > (SELECT n-? FROM kblocks WHERE hash  = ?) and n <= (SELECT n FROM kblocks WHERE hash  = ?)`, [target,kblock_hash,kblock_hash])
		let res = await this.request(sql);
		return res[0];
	}

	async get_time_delta_kblock(kblock_hash, target){
		let sql = mysql.format(`SELECT 
				t2.time - t1.time AS time
				FROM kblocks t1 
				INNER JOIN kblocks t2 ON t1.n = (t2.n - ?) where t2.hash = ?`, [target, kblock_hash])
		let res = await this.request(sql);
		return res[0];
	}

	async get_iterm(kblock_hash, ki, period) {
		let sql = mysql.format(`SELECT FLOOR(sum(?*(t1.time - t2.time)/100)) AS iterm FROM
									(SELECT  n, time
									FROM kblocks,
            						(SELECT @n:=n FROM kblocks WHERE hash  = ?) AS N
									WHERE n > @n-? and n <= @n) as t1
            						LEFT JOIN kblocks t2 ON t2.n = (t1.n - ?) `, [ki,kblock_hash, period, period]);
		let res = await this.request(sql);
		return res[0];
	}

	async get_mining_tkn_owners(limit, ignore_owners, min_stake) {
		let sql = mysql.format(`SELECT id FROM (
								SELECT DISTINCT id, amount FROM tokens
								LEFT JOIN ledger ON tokens.owner = ledger.id AND ledger.token = ?
								WHERE minable = true
								AND id NOT IN (?)
								AND amount > ?
								ORDER BY amount DESC LIMIT ?) as SUB_T`, [Utils.ENQ_TOKEN_NAME, ignore_owners, min_stake, limit]);
		return this.request(sql);
	}

	async get_used_slots(kblock_hash) {
		let sql = mysql.format(`SELECT owner AS id, count(*) AS count FROM mblocks
									LEFT JOIN tokens ON tokens.hash = mblocks.token 
									WHERE kblocks_hash = ?
									GROUP BY owner;`, [kblock_hash]);
		return this.request(sql);
	}

	async get_txs_awaiting(mblock_hashes){
		return (await this.request(mysql.format('SELECT COUNT(*) as txs_awaiting FROM transactions LEFT JOIN mblocks ON mblocks.hash = transactions.mblocks_hash WHERE mblocks.hash in (?);', [mblock_hashes])))[0];
	}

	async get_microblocks_full(hash, token){
		let mblocks = [];
		if(token)
			mblocks = await this.request(mysql.format("SELECT `publisher`, `referrer`, `sign`, `leader_sign`, `hash`, `kblocks_hash`, `reward`, `nonce`, `token` FROM mblocks WHERE `kblocks_hash`=? and `token`=?", [hash, token]));
		else
			mblocks = await this.request(mysql.format("SELECT `publisher`, `referrer`, `sign`, `leader_sign`, `hash`, `kblocks_hash`, `reward`, `nonce`, `token` FROM mblocks WHERE `kblocks_hash`=?", hash));

		for (let i = 0; i < mblocks.length; i++) {
			mblocks[i].leader_sign = JSON.parse(mblocks[i].leader_sign);
			mblocks[i].txs = await this.request(mysql.format('SELECT `hash`, `from`, `to`, `amount`, `nonce`, `sign`, `ticker`, `data` FROM transactions WHERE mblocks_hash = ? ORDER BY transactions.hash;', mblocks[i].hash));
			//TODO: удалять хеш (чтобы не забыть пересчитать при получении)
			//delete mblocks[i].hash;
		}
		return mblocks;
	}

	async get_new_microblocks(kblocks_hash, limit){
		let txs;
		let mblocks = await this.request(mysql.format('SELECT * FROM mblocks WHERE ? AND ? AND ? ORDER BY mblocks.hash ASC LIMIT ?', [{kblocks_hash}, {included:1}, {calculated:0}, limit || 65535]));
		if (mblocks.length > 0) {
			txs = await this.request(mysql.format('SELECT * FROM transactions WHERE mblocks_hash IN (?) ORDER BY `mblocks_hash`, `hash` ASC;', [mblocks.map(m => m.hash)]));
		}
		return {mblocks, txs};
	}

	async get_exist_microblocks(hashes){
		let exists = await this.request(mysql.format('SELECT hash FROM mblocks WHERE hash in (?)', [hashes]));
		return exists;
	} 

	async get_exist_statblocks(hashes){
		let exists = await this.request(mysql.format('SELECT hash FROM sblocks WHERE hash in (?)', [hashes]));
		return exists;
	} 

	async get_new_statblocks(kblocks_hash, limit){
		let sblocks = await this.request(mysql.format('SELECT * FROM sblocks WHERE ? AND ? AND ? ORDER BY sblocks.hash ASC LIMIT ?', [{kblocks_hash}, {included:1}, {calculated:0}, limit || 65535]));
		return sblocks;
	}

	async get_statblocks_publishers(kblocks_hash){
		let accounts = await this.request(mysql.format('SELECT publisher FROM sblocks WHERE ? AND ? ORDER BY sblocks.hash', [{kblocks_hash}, {included:1}]));
		return accounts;
	}

	async get_not_indexed_microblocks(kblocks_hash, limit){
		let txs;
		let mblocks = await this.request(mysql.format('SELECT * FROM mblocks WHERE ? AND ? AND ? AND ? ORDER BY mblocks.hash ASC LIMIT ?', [{kblocks_hash}, {included:1}, {calculated:1}, {indexed:0}, limit || 65535]));
		if (mblocks.length > 0) {
			txs = await this.request(mysql.format('SELECT * FROM transactions WHERE mblocks_hash IN (?) ORDER BY `mblocks_hash`, `hash` ASC;', [mblocks.map(m => m.hash)]));
		}
		return {mblocks, txs};
	}

	async get_not_indexed_statblocks(kblocks_hash, limit){
		let sblocks = await this.request(mysql.format('SELECT * FROM sblocks WHERE ? AND ? AND ?  AND ? ORDER BY sblocks.hash ASC LIMIT ?', [{kblocks_hash}, {included:1}, {calculated:1}, {indexed:0}, limit || 65535]));
		return sblocks;
	}

	put_microblocks(mblocks) {
		let sql_m = [];
		let sql_tx = [];

		console.trace(`putting mblocks hashes: ${JSON.stringify(mblocks.map(m => m.hash))}`);
		let i = 0;
		mblocks.forEach((m) => {
			i++;
			if (m.txs === undefined || m.txs.length === 0) {
				console.warn(`ignore empty microblock ${m.hash}`);
				return;
			}
			sql_m.push(mysql.format('INSERT IGNORE INTO mblocks (`hash`, `kblocks_hash`, `publisher`, `reward`, `sign`, `leader_sign`, `referrer`, `nonce`, `token`) VALUES (?)', [[m.hash, m.kblocks_hash, m.publisher, m.reward, m.sign,  JSON.stringify(m.leader_sign), m.referrer, m.nonce, m.token]]));
			sql_tx.push(mysql.format('INSERT IGNORE INTO transactions (`hash`, `from`, `to`, `amount`, `mblocks_hash`, `nonce`, `sign`, `ticker`, `data`) VALUES ?', [m.txs.map(tx => [tx.hash, tx.from, tx.to, tx.amount, m.hash, tx.nonce, tx.sign, tx.ticker, tx.data])]));
		});
		return this.transaction([sql_m.join(";"), sql_tx.join(";")].join(";"));
	}

	put_statblocks(sblocks){
		let sql_s = [];
		console.trace(`putting sblocks ${JSON.stringify(sblocks.map(s => s.hash))}`);
		sblocks.forEach((s) => {
			sql_s.push(mysql.format('INSERT IGNORE INTO sblocks (`hash`, `kblocks_hash`, `publisher`, `sign`, `bulletin`) VALUES (?)', [[s.hash, s.kblocks_hash, s.publisher, s.sign, s.bulletin]]));
		});
		return this.transaction(sql_s.join(";"));
	}

	async finalize_macroblock(kblock, mblocks, sblocks){
		console.silly("macroblock data", JSON.stringify(kblock), JSON.stringify(mblocks));
		console.debug(`finalizing macroblock ${kblock.hash} stat: mblocks.length = ${mblocks.length}`);
		console.debug(`macroblock ${kblock.hash} mblocks: `, mblocks.map(m => m.hash));
		console.debug(`macroblock ${kblock.hash} sblocks: `, sblocks.map(s => s.hash));

		let exist_mblocks_cnt = (await this.request(mysql.format('SELECT count(*) as cnt FROM mblocks WHERE `hash` in (?)', [mblocks.map(b => [b.hash])])))[0].cnt;
		let exist_sblocks_cnt = (await this.request(mysql.format('SELECT count(*) as cnt FROM sblocks WHERE `hash` in (?)', [sblocks.map(b => [b.hash])])))[0].cnt;

		if(Number(exist_mblocks_cnt) !== mblocks.length || Number(exist_sblocks_cnt)  !== sblocks.length) {
			console.warn(`Macroblock is not complete.
			 					   Exist mblocks count ${exist_mblocks_cnt}, finalize count ${mblocks.length}.
			 					   Exist sblocks count ${exist_sblocks_cnt}, finalize count ${sblocks.length}.`);
			return false;
		}

		let sql_m = [];
		let sql_s = [];

		if (mblocks.length > 0) {
			mblocks.forEach(m => {
				sql_m.push(mysql.format('UPDATE mblocks SET `included`= 1 WHERE `hash` = ?', [m.hash]));
			});
		}

		if (sblocks.length > 0) {
			sblocks.forEach(s => {
				sql_s.push(mysql.format('UPDATE sblocks SET `included`= 1 WHERE `hash` = ?', [s.hash]));
			});
		}

		let sql_k = mysql.format(`INSERT INTO kblocks (hash, link, n, sprout, time, publisher, reward, nonce, m_root, target_diff) SELECT ?, ?, n + 1, sprout, ?, ?, ?, ?, ?,? FROM kblocks WHERE hash = ?`, [kblock.hash, kblock.link, kblock.time, kblock.publisher, kblock.reward, kblock.nonce, kblock.m_root, kblock.target_diff, kblock.link]);
		console.debug(`try insert new kblock ${sql_k}`);
		return this.transaction([sql_s.join(";"), sql_m.join(";"), sql_k].join(";"));
	}

	create_sprout(block){
		let sql_with_sprout = mysql.format(`
							INSERT INTO sprouts (sprout, fork, n, branch) SELECT ?, ?, n, sprout FROM kblocks WHERE hash = ?;
							INSERT INTO kblocks (hash, link, n, sprout, time, publisher, nonce, m_root, reward)
							SELECT ?, ?, n + 1, ?, ?, ?, ?, ?, ? FROM kblocks WHERE hash = ?;`, [block.hash, block.link, block.link,
			block.hash, block.link, block.hash, block.time, block.publisher, block.nonce, block.m_root, block.reward, block.link]);
		return this.transaction(sql_with_sprout);
	};

	async create_snapshot(hash){
		let snapshot = {};
		snapshot.kblocks_hash = hash;
		snapshot.ledger = await this.request(mysql.format("SELECT id, amount, token FROM ledger ORDER BY id, token"));
		snapshot.tokens = await this.request(mysql.format("SELECT * FROM tokens ORDER BY hash"));
		snapshot.poses = await this.request(mysql.format("SELECT id, owner, fee, name FROM poses ORDER BY id"));
		snapshot.delegates = await this.request(mysql.format("SELECT pos_id, delegator, amount, reward FROM delegates ORDER BY pos_id, delegator"));
		snapshot.undelegates = await this.request(mysql.format("SELECT id, pos_id, amount, height FROM undelegates ORDER BY id"));
		return snapshot;
	};

	get_chain_start_macroblock(){
	    //get ferst of chain macroblock
        let block = this.request(mysql.format(`SELECT sprout, n, kblocks.hash, time, publisher, nonce, link, m_root, reward FROM kblocks 
                                                    LEFT JOIN snapshots ON kblocks.hash = snapshots.kblocks_hash WHERE kblocks.hash = link AND snapshots.hash IS NOT NULL ORDER BY n DESC LIMIT 1;`));
        return block;
    }

	async peek_tail(timeout){
		let now = new Date();
		let span = now - this.last_tail;
		if ((span > timeout) || (this.cached_tail === null) || (timeout === undefined)) {
			let tail = await this.request(mysql.format("SELECT sprout, n, hash, time, publisher, nonce, link, m_root, reward FROM kblocks WHERE hash != link or n = 0 ORDER BY n DESC LIMIT 1"));
			if (tail)
				tail = tail[0];
			else
				return;
			this.cached_tail = tail;
			this.last_tail = now;
			return tail;
		} else {
			return this.cached_tail;
		}
	};

	async init_database() {
        console.info("Initializing database...");
        let snapshot = Utils.load_snapshot_from_file(this.app_config.snapshot_file);
        //TODO: validation snapshot
        if (snapshot === undefined) {
            console.error(`Snapshot is undefined`);
            return;
        }
        snapshot.hash = Utils.hash_snapshot(snapshot);
        let init_result = await this.init_snapshot(snapshot, true);
        if (!init_result) {
            console.error(`Failed initialize Database.`);
            return;
        }
        console.info("Database initialized");
    }

	peek_range(min, max) {
		let sql = mysql.format("SELECT n, hash, time, publisher, nonce, link, m_root, reward FROM kblocks WHERE n >= ? AND n <= ? ORDER BY n ASC", [min, max]);
		return this.request(sql);
	};

	async get_page(page_num, page_size){
		let count = (await this.request(mysql.format("SELECT count(*) AS cnt FROM kblocks WHERE kblocks.n <= (SELECT n-1 FROM kblocks WHERE hash = (SELECT `value` FROM stat WHERE `key` = 'cashier_ptr'))")))[0].cnt;
		let kblocks = await this.request(mysql.format('SELECT kblocks.*, count(transactions.hash) as tx_count FROM kblocks LEFT JOIN mblocks ON kblocks.hash = mblocks.kblocks_hash LEFT JOIN transactions ON mblocks.hash = transactions.mblocks_hash AND (transactions.status = 1 OR transactions.status = 2 OR transactions.status = 3) WHERE `n` < ? AND `n` >= ? GROUP BY kblocks.hash ORDER BY `n` DESC',
			[count - page_size * page_num, count - page_size * page_num - page_size] ));

		return {count : Math.ceil(count / page_size), kblocks};
	}
	// TODO: for Explorer can be optimized for only hashes
	async get_lastblocks(count){
		let blocks = await this.request(mysql.format("SELECT * FROM kblocks WHERE kblocks.n <= (SELECT n-1 FROM kblocks WHERE hash = (SELECT `value` FROM stat WHERE `key` = 'cashier_ptr')) ORDER BY n DESC LIMIT ?", count));
		return blocks;
	}

	async get_difficulty(limit){
		let data = await this.request(mysql.format('SELECT AVG(target_diff) AS target_diff FROM (SELECT target_diff FROM kblocks ORDER BY n DESC LIMIT ?) T ', limit));		
		if(data.length === 1)
			return {difficulty: Utils.understandable_difficulty(data[0].target_diff).toFixed(2)};
		else
			return {difficulty: -1};
	}

	// TODO: for Explorer can be optimized for only hashes
	async get_lasttxs(count){
		let txs = await this.request(mysql.format("SELECT transactions.* FROM kblocks, mblocks, transactions WHERE kblocks.hash = mblocks.kblocks_hash AND mblocks.hash = transactions.mblocks_hash and kblocks.n = (select n-1 from kblocks where hash = (select `value` from stat where `key` = 'cashier_ptr')) LIMIT ?", count));
		return {txs};
	}

	async get_successful_txs_by_height(height) {
		let error = {code: 0, msg: 'successfully'};
		let txs = [];
		try {
			let status = (await this.request(mysql.format(`SELECT IFNULL(sum(IFNULL(included,0)),-1) AS included, IFNULL(sum(IFNULL(calculated,0)),-1) AS calculated FROM mblocks inner join kblocks ON kblocks.hash = mblocks.kblocks_hash WHERE n = ?`, height)))[0];
			if (status.included <= 0) {
				error.code = 1;
				error.msg = 'block not found';
				return;
			}
			if (status.calculated <= 0) {
				error.code = 2;
				error.msg = 'block not calculated';
				return;
			}
			txs = await this.request(mysql.format(`SELECT transactions.* FROM transactions 
													LEFT JOIN mblocks ON mblocks.hash = transactions.mblocks_hash AND mblocks.included = 1 AND calculated = 1
													LEFT JOIN kblocks ON kblocks.hash = mblocks.kblocks_hash  WHERE status = 3 AND kblocks.n = ?`, height));
		}
		catch(e){
			console.error(e);
			error = {code: 3, msg: 'exaption'};
		}
		finally {
			return {error, data: {txs}};
		}
	}

	async get_tx_count_ranged(limit){
		let res = await this.request(mysql.format(`SELECT count(*) as count FROM transactions as T
			left join mblocks as M ON T.mblocks_hash = M.hash
			left join kblocks as K ON M.kblocks_hash = K.hash
			WHERE (K.n) >= ((SELECT n FROM kblocks WHERE hash = (SELECT stat.value FROM stat WHERE stat.key = 'cashier_ptr')) - ?)
			AND T.status = 3`, limit));
		return res;
	}

	async get_tps(interval){
		let tps = (await this.request(mysql.format('SELECT ROUND(count(*)/?) AS tps FROM transactions, kblocks, mblocks WHERE transactions.mblocks_hash = mblocks.hash AND mblocks.kblocks_hash = kblocks.hash AND kblocks.time > unix_timestamp() - ? ORDER BY kblocks.n DESC', [interval, interval])))[0];
		return tps;
	}

	async get_poa_reward(){
		let reward = (await this.request(mysql.format('SELECT SUM(mblocks.reward) AS reward FROM mblocks LEFT JOIN kblocks ON kblocks.hash = mblocks.kblocks_hash WHERE mblocks.included = 1 AND kblocks.time > UNIX_TIMESTAMP() - 24*60*60 AND mblocks.token = ?',[Utils.ENQ_TOKEN_NAME])))[0];
		return reward;
	}

	async get_pow_reward(){
		let reward = (await this.request(mysql.format('SELECT SUM(reward) AS reward FROM kblocks WHERE kblocks.time > UNIX_TIMESTAMP() - 24*60*60')))[0];
		return reward;
	}

	async get_pos_reward(){
		let reward = (await this.request(mysql.format('SELECT SUM(sblocks.reward) AS reward FROM sblocks LEFT JOIN kblocks ON kblocks.hash = sblocks.kblocks_hash WHERE kblocks.time > UNIX_TIMESTAMP() - 24*60*60')))[0];
		return reward;
	}

	async get_mblock_data(hash){
		let transactions = await this.request(mysql.format('SELECT transactions.* FROM mblocks, transactions WHERE `calculated` > 0 AND mblocks.hash = transactions.mblocks_hash AND mblocks.hash = ?', hash));
		let header = (await this.request(mysql.format("SELECT kblocks_hash, mblocks.publisher as publisher, mblocks.referrer as referrer, mblocks.hash as mblocks_hash, mblocks.reward as reward, mblocks.nonce, mblocks.token FROM mblocks, kblocks WHERE `calculated` > 0 AND kblocks.hash = mblocks.kblocks_hash AND mblocks.hash=?", hash)))[0];
		return {transactions, header};
	}

	async get_sblock_data(hash){
		let header = (await this.request(mysql.format("SELECT kblocks_hash, sblocks.publisher as publisher, sblocks.hash as sblocks_hash, sblocks.reward as reward FROM sblocks, kblocks WHERE `calculated` > 0 AND kblocks.hash = sblocks.kblocks_hash AND sblocks.hash=?", hash)))[0];
		return {header};
	}

	async get_pos_statuses(data){
		let res = await this.request(mysql.format(`SELECT S.publisher AS pos_id, count(S.kblocks_hash) AS uptime FROM sblocks AS S
			INNER JOIN kblocks AS K ON S.kblocks_hash = K.hash
			AND K.n > ? AND S.reward IS NOT NULL
			GROUP BY S.publisher`, data.n));
		return res;
	}

	async clear_uptime_poses(){
		let res = await this.request(mysql.format(`UPDATE IGNORE poses 
											SET uptime = 0
											WHERE uptime != 0`));
	}

	async update_pos_statuses(data){
		let res = await this.request(mysql.format(`UPDATE poses SET uptime = ? WHERE id = ?`, [data.uptime, data.pos_id]));
		return res;
	}

	async update_total_supply(amount, token){
		let res = await this.request(mysql.format(`UPDATE tokens SET total_supply = ? WHERE hash = ?`, [amount, token]));
		return res;
	}

	async get_macroblock_header(hash){
		let kblock = (await this.request(mysql.format('SELECT * FROM kblocks WHERE `hash` = ?', hash)))[0];
		let mblocks = await this.request(mysql.format('SELECT mblocks.hash, count(*) as tx_cnt FROM kblocks, mblocks, transactions WHERE `calculated` > 0 AND kblocks.hash = mblocks.kblocks_hash AND mblocks.hash = transactions.mblocks_hash AND kblocks.hash = ? GROUP BY `hash`;', hash));
		let sblocks = await this.request(mysql.format('SELECT sblocks.hash  FROM kblocks, sblocks WHERE `calculated` > 0 AND kblocks.hash = sblocks.kblocks_hash AND kblocks.hash = ? GROUP BY `hash`;', hash));
		let snapshot = (await this.request(mysql.format('SELECT hash FROM snapshots WHERE `kblocks_hash` = ?', hash)));
		let snapshot_hash = null;
		if(snapshot.length > 0)
			snapshot_hash = snapshot[0].hash;
		return {kblock, mblocks, sblocks, snapshot_hash};
	}
	
	async get_macroblock_header_by_height(height){
		let kblock = (await this.request(mysql.format('SELECT * FROM kblocks WHERE `n` = ?', height)))[0];
		let mblocks = await this.request(mysql.format('SELECT mblocks.hash, count(*) as tx_cnt FROM kblocks, mblocks, transactions WHERE `calculated` > 0 AND kblocks.hash = mblocks.kblocks_hash AND mblocks.hash = transactions.mblocks_hash AND kblocks.hash = ? GROUP BY `hash`;', kblock.hash));
		let sblocks = await this.request(mysql.format('SELECT sblocks.hash  FROM kblocks, sblocks WHERE `calculated` > 0 AND kblocks.hash = sblocks.kblocks_hash AND kblocks.hash = ? GROUP BY `hash`;', kblock.hash));

		return {kblock, mblocks, sblocks};
	}

	async get_macroblock(hash){
		console.trace(`get_macroblock ${hash}`);
		//TODO разнести функции получения макроблока для эксплорера и для синка. В версии синка не получать реварды и хеши
		let kblock = (await this.request(mysql.format("SELECT `publisher`, `time`, `nonce`, `link`, `n`, `m_root` FROM kblocks WHERE `hash`=?", hash)))[0];
		let mblocks = await this.request(mysql.format("SELECT `publisher`, `referrer`, `sign`, `leader_sign`, `hash`, `kblocks_hash`, `nonce`, `token` FROM mblocks WHERE `included` = 1 AND `kblocks_hash`=?", hash));
		let sblocks = await this.request(mysql.format("SELECT `publisher`, `sign`, `hash`, `kblocks_hash`, `bulletin` FROM sblocks WHERE `included` = 1 AND `kblocks_hash`=?", hash));

		for (let i = 0; i < mblocks.length; i++) {
			mblocks[i].leader_sign = JSON.parse(mblocks[i].leader_sign);
			mblocks[i].txs = await this.request(mysql.format('SELECT `hash`, `from`, `to`, `amount`, `nonce`, `sign`, `ticker`, `data` FROM transactions WHERE mblocks_hash = ? ORDER BY transactions.hash;', mblocks[i].hash));
			//TODO: удалять хеш (чтобы не забыть пересчитать при получении)
			//delete mblocks[i].hash;
		}

		return {kblock, mblocks, sblocks};
	}

	async get_mblock(hash){
		return await this.request(mysql.format('SELECT * FROM mblocks WHERE `calculated` > 0 AND `hash` = ?', hash));
	}

	async get_referrer_stake(){
		let stats = (await this.request(mysql.format("SELECT `key`, `value` FROM stat WHERE `key` IN (?);", [['referrer_stake']])));

		stats = stats.reduce((a,c) => {
			a[c.key] = c.value;
			return a;
		}, {});
		return stats;
	}

	async get_total_pos_stake(){
		let stats = (await this.request(mysql.format("SELECT `key`, `value` FROM stat WHERE `key` IN (?);", [['total_daily_pos_stake']])));

		stats = stats.reduce((a,c) => {
			a[c.key] = c.value;
			return a;
		}, {});
		return stats;
	}


	async get_mblocks_info(offset, max){
		let info = await this.request(mysql.format(`SELECT kblocks.hash AS k_hash, mblocks.hash AS m_hash, mblocks.publisher AS publisher, mblocks.reward AS reward, time AS k_time, n AS height 
			FROM kblocks 
			LEFT JOIN mblocks ON mblocks.kblocks_hash = kblocks.hash 
			WHERE kblocks.n >= ? AND kblocks.n <= ? AND included = 1 
			ORDER BY n;`, [offset, max]));
		return info;
	}

	async get_mblocks_height(){
		let block = await this.request(mysql.format('SELECT n as height FROM kblocks ORDER BY n DESC LIMIT 1'));
		return block[0];
	}

	async count_total_daily_stake(){
		let stake = (await this.request(mysql.format('SELECT sum(ledger.amount) AS stake FROM (SELECT DISTINCT mblocks.publisher AS pub FROM kblocks LEFT JOIN mblocks ON mblocks.kblocks_hash = kblocks.hash WHERE kblocks.time > unix_timestamp() - 24*60*60) t LEFT JOIN ledger on ledger.id = t.pub  WHERE token = ?', Utils.ENQ_TOKEN_NAME)))[0];
		return stake;
	}

	async count_total_daily_pos_stake(){
		let stake = (await this.request(mysql.format('SELECT sum(ledger.amount) AS stake FROM (SELECT DISTINCT sblocks.publisher AS pub FROM kblocks LEFT JOIN sblocks ON sblocks.kblocks_hash = kblocks.hash WHERE kblocks.time > unix_timestamp() - 24*60*60) t LEFT JOIN ledger on ledger.id = t.pub;')))[0];
		return stake;
	}

	async get_roi(token){
		let data = (await this.request(mysql.format("SELECT token, calc_stakes, calc_rois FROM rois WHERE token = ?;", token)))[0];
		if(data === undefined){
			console.info(`token ${token} not found`);
			return [];
		}


		let roi = [];
		if (data.calc_stakes === null || data.calc_rois === null){
			console.info(`calc_stakes or calc_rois is not defined`);
		} else {
			let stakes = data.calc_stakes.split(';');
			let rois = data.calc_rois.split(';');

			if (stakes.length !== rois.length){
				console.warn(`calc_stakes and calc_rois length do not match`);
			} else {
				for (let i = 0; i < stakes.length; i++){
					roi.push({stake:parseFloat(stakes[i]), roi:parseFloat(rois[i])});
				}
			}
		}

		return roi;
	}

	async get_staking_poa_count(){	
		let count = (await this.request(mysql.format('SELECT count(*) as total FROM ledger WHERE amount >= ? AND `token` = ?', [this.app_config.stake_limits.min_stake, Utils.ENQ_TOKEN_NAME])))[0];
		return count;
	}

	async get_ver(){
		let stats = (await this.request(mysql.format("SELECT `key`, `value` FROM stat WHERE `key` IN (?);", [['minApkVersion', 'maxApkVersion', 'apkUrl']])));

		stats = stats.reduce((a,c) => {
			a[c.key] = c.value;
			return a;
		}, {});

		return stats;
	}

	async get_pending_size()
	{
		let size = (await this.request(mysql.format("SELECT Count(*) as `count` FROM pending ;")));
		return size;
	}

	async get_pending()
	{
		let res = (await this.request(mysql.format("SELECT * FROM pending")));
		return res;
	}

	async pending_check(hash)
	{
		let res = (await this.request(mysql.format(`SELECT 1 FROM pending WHERE hash = ? LIMIT 1`, hash)));
		return res.length !== 0;
	}

	async get_pending_by_hash(hash)
	{
		let size = (await this.request(mysql.format("SELECT `hash`, timeadded, amount, `from`, `to`, nonce, ticker, `data`, sign FROM pending WHERE hash = ?;", hash)));
		return size;
	}

	async get_pending_by_id(options)
	{
		let sql;
		if(options.filter === 'from')
			sql = mysql.format("SELECT `hash`, timeadded, amount, `from`, `to`, nonce, ticker, `data`, sign FROM pending WHERE `from` = ? ", options.id);
		else if(options.filter === 'to')
			sql = mysql.format("SELECT `hash`, timeadded, amount, `from`, `to`, nonce, ticker, `data`, sign FROM pending WHERE `to` = ? ", options.id);
		else
			sql = mysql.format("SELECT `hash`, timeadded, amount, `from`, `to`, nonce, ticker, `data`, sign FROM pending WHERE `from` = ? OR `to` = ?;", [options.id, options.id]);

		let res = await this.request(sql);
		return res;
	}

	async get_stats(values){
		//let stats = (await this.request(mysql.format("SELECT `key`, `value` FROM stat WHERE `key` IN (?) AND (unix_timestamp() - `calctime` <= `lifetime` OR `lifetime` = 0);", [values])));
		let stats = (await this.request(mysql.format("SELECT `key`, `value`, `calctime`, `lifetime` FROM stat WHERE `key` IN (?);", [values])));
/*
		stats = stats.reduce((a,c) => {
			a[c.key] = c.value;
			a[c.key] = c.prev_value;
			a[c.key] = c.value;
			return a;
		}, {});
*/
		return stats;
	}

	async get_stat(){
		let stats = await this.request(mysql.format("SELECT * FROM stat"));
		return stats;
	}

	async update_stats(values){
		let sql = [];
		for (let prop in values){
			sql.push(mysql.format('INSERT INTO stat (`key`, `value`, `calctime`) VALUES (?, ?, UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE `value` = VALUES(value), `calctime` = UNIX_TIMESTAMP()', [prop, values[prop]]));
		}
		if(sql.length === 1)
			return this.request(sql.join(';'));
		else
			return this.transaction(sql.join(';'));
	}


	async get_peer_count(type){
		//return this.request('SELECT ANY_VALUE(`type`) as type, sum(`count`) as count FROM clients GROUP BY `type`;');
		return (await this.request(mysql.format('SELECT sum(`count`) as count FROM clients WHERE `type` = ?;', type)))[0];
	}

	async get_accounts_count(token_hash){
		if(token_hash === undefined)
			token_hash =Utils.ENQ_TOKEN_NAME;
		let cnt = (await this.request(mysql.format("SELECT count(*) as count FROM ledger WHERE `token` = ?", token_hash)))[0];
		return cnt;
	}

	async get_tokens_count(){
		let cnt = (await this.request(mysql.format(`SELECT count(*) as count,  SUM(if(reissuable = 0 AND minable = 0, 1, 0)) as non_reissuable, SUM(if(reissuable = 1, 1, 0)) as reissuable, SUM(if(minable = 1, 1, 0)) as minable FROM tokens`)))[0];
		return cnt;
	}

	async get_tickers_all(){
		let tickers_all = await this.request(mysql.format("SELECT hash, ticker, caption FROM tokens"));
		return tickers_all;
	}

	async get_circulating_supply(){
		let amount = (await this.request(mysql.format("SELECT SUM(amount) as amount FROM ledger WHERE `token` = ?", Utils.ENQ_TOKEN_NAME)))[0];
		return amount;
	}

	async get_total_supply(){
		let amount = (await this.request(mysql.format(`select (L.led + D.del + R.rew + U.und) as amount from
			(select ifnull(sum(amount), 0) as led from ledger where token = ?) as L,
			(select ifnull(sum(amount), 0) as del from delegates) as D,
			(select ifnull(sum(reward), 0) as rew from delegates) as R,
			(select ifnull(sum(amount), 0) as und from undelegates) as U`, [Utils.ENQ_TOKEN_NAME])))[0];
		return amount;
	}

	generate_eindex(rewards, time = null, tokens_counts){
		let ind = [];
		let idx_types = ['iin', 'iout', 'ik', 'im', 'istat', 'iref', 'iv', 'ic', 'ifk', 'ifg', 'ifl', 'idust'];
		let tx_types = ['iin', 'iout'];
		let legacy_types = ['iin', 'iout', 'ik', 'im', 'istat', 'iref'];
		for(let rec of rewards){
			rec.rectype = tx_types.includes(rec.type) ? 'itx' : 'irew';
			if(idx_types.includes(rec.type)){
				if(legacy_types.includes(rec.type)){
					ind.push(mysql.format(`INSERT INTO eindex (hash, time, id, ??, i, ??, value, rectype) 
						SELECT ?, ?, ?, 
						IFNULL((SELECT ?? + 1 FROM eindex WHERE id=? ORDER BY ?? DESC LIMIT 1), 0), 
						IFNULL((SELECT i+1 FROM eindex WHERE id=? ORDER BY i DESC LIMIT 1), 0),
						IFNULL((SELECT ?? + 1 FROM eindex WHERE id=? ORDER BY ?? DESC LIMIT 1), 0), ?, ?`,
						[rec.type, rec.rectype, rec.hash, time, rec.id, rec.type, rec.id, rec.type,
							rec.id,
							rec.rectype, rec.id, rec.rectype,
							rec.value, rec.type]));
				}
				else
					ind.push(mysql.format(`INSERT INTO eindex (hash, time, id, i, ??, value, rectype) 
						SELECT ?, ?, ?, 
						IFNULL((SELECT i+1 FROM eindex WHERE id=? ORDER BY i DESC LIMIT 1), 0),
						IFNULL((SELECT ?? + 1 FROM eindex WHERE id=? ORDER BY ?? DESC LIMIT 1), 0), ?, ?`,
						[rec.rectype, rec.hash, time, rec.id,
							rec.id,
							rec.rectype, rec.id, rec.rectype,
							rec.value, rec.type]));
			}
		}
		for(let tok in tokens_counts){
			ind.push(mysql.format("INSERT INTO tokens_index (`hash`) VALUES (?) ON DUPLICATE KEY UPDATE `txs_count` = `txs_count` + ?", [tok, tokens_counts[tok]]));
		}
		return ind;
	}

	terminate_ledger_kblock(accounts, kblock, mblocks, sblocks, post_action, supply_change, rewards){
		let ins = mysql.format("INSERT INTO ledger (`id`, `amount`, `token`) VALUES ? ON DUPLICATE KEY UPDATE `amount` = VALUES(amount)", [accounts.map(a => [a.id, a.amount, a.token])]);
		let sw = mysql.format("INSERT INTO stat (`key`, `value`) VALUES ('cashier_ptr', (SELECT `hash` FROM kblocks WHERE `link` = ? AND `hash` <> `link`)) ON DUPLICATE KEY UPDATE `value` = VALUES(value)", kblock.hash);
		let krew = 	mysql.format("UPDATE kblocks SET `reward` = ? WHERE `hash` = ?", [kblock.reward, kblock.hash]);

		let mb = [];
		let sb = [];
		let sc = [];

		mblocks.forEach(function (m) {
			mb.push(mysql.format("UPDATE mblocks SET `reward` = ? WHERE `hash` = ?", [m.reward, m.hash]));
		});
		sblocks.forEach(function (s) {
			sb.push(mysql.format("UPDATE sblocks SET `calculated` = 1, `reward` = ? WHERE `hash` = ?", [s.reward, s.hash]));
		});
		for(let hash in supply_change)
			sc.push(mysql.format("UPDATE tokens SET total_supply = total_supply + ? WHERE hash = ?", [supply_change[hash], hash]));

		let ind = this.generate_eindex(rewards, kblock.time);

		return this.transaction([ins, krew, mb.join(';'), sb.join(';'), sc.join(';'), sw, post_action.join(';'), ind.join(';')].join(';'));
	}

	terminate_indexer_kblock(kblock){
		let sql_i = mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `ik`, `i`) SELECT ?, ?, ?, IFNULL((SELECT ik+1 FROM eindex WHERE `id`=? ORDER BY `ik` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [kblock.hash, kblock.time, kblock.publisher, kblock.publisher, kblock.publisher]);

		let sw = mysql.format("INSERT INTO stat (`key`, `value`) VALUES ('indexer_ptr', (SELECT `hash` FROM kblocks WHERE `link` = ? AND `hash` <> `link`)) ON DUPLICATE KEY UPDATE `value` = VALUES(value)", kblock.hash);
		return this.transaction([sql_i, sw].join(';'));
	}

	process_ledger_mblocks(accounts, txs, mblocks, post_action, rewards, kblock, tokens_counts){
		let sts = [];
		let pnd = [];
		let ind = [];

		let ins = mysql.format("INSERT INTO ledger (`id`, `amount`, `token`) VALUES ? ON DUPLICATE KEY UPDATE `amount` = VALUES(amount)", [accounts.map(a => [a.id, a.amount, a.token])]);
		let mb = mysql.format('UPDATE mblocks SET calculated = 1 WHERE `hash` in (?)', [mblocks.map(m => m.hash)]);

		if (txs.length) {
			txs.forEach(function (s) {
				sts.push(mysql.format("UPDATE transactions SET `status` = ? WHERE `hash` = ? AND `mblocks_hash` = ?", [s.status, s.hash, s.mblocks_hash]));
				// TODO: DELETE FROM pending WHERE `hash` in (?)
				pnd.push(mysql.format("DELETE FROM pending WHERE `hash` = ?", s.hash));
			});
		}

		ind = this.generate_eindex(rewards, kblock.time, tokens_counts);

		let sql = [ins, sts.join(';'), pnd.join(';'), ind.join(';'), mb, post_action.join(';')].join(';');
		return this.transaction(sql);
	}

	process_indexer_sblocks(sblocks, time){
		let index = [];
		let sb = mysql.format('UPDATE sblocks SET indexed = 1 WHERE `hash` in (?)', [sblocks.map(s => s.hash)]);
		if (time){
			sblocks.forEach(function (s) {
				index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `istat`, `i`) SELECT ?, ?, ?, IFNULL((SELECT istat+1 FROM eindex WHERE `id`=? ORDER BY `istat` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [s.hash, time, s.publisher, s.publisher, s.publisher]));
			});
		} else {
			console.trace(`indexes sblocks upgrade disabled`);
		}
		let sql = [index.join(';'), sb].join(';');
		return this.transaction(sql);
	}		

	process_indexer_mblocks(txs, mblocks, refs, time){		
		let mb = mysql.format('UPDATE mblocks SET indexed = 1 WHERE `hash` in (?)', [mblocks.map(m => m.hash)]);
		let index = [];
		let tokens_index = [];
		if (time){
			mblocks.forEach(function (m) {
				index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `im`, `i`) SELECT ?, ?, ?, IFNULL((SELECT im+1 FROM eindex WHERE `id`=? ORDER BY `im` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [m.hash, time, m.publisher, m.publisher, m.publisher]));
			});

			refs.forEach(function (ref) {
				index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `iref`, `i`) SELECT ?, ?, ?, IFNULL((SELECT iref+1 FROM eindex WHERE `id`=? ORDER BY `iref` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [ref.hash, time, ref.referrer, ref.referrer, ref.referrer]));
				if (ref.referral !== null)
					index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `iref`, `i`) SELECT ?, ?, ?, IFNULL((SELECT iref+1 FROM eindex WHERE `id`=? ORDER BY `iref` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [ref.hash, time, ref.referral, ref.referral, ref.referral]));
			});

			txs.forEach(function (tx) {
				if ((tx.status === Utils.TX_STATUS.REJECTED) || (tx.status === Utils.TX_STATUS.CONFIRMED)) {
					index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `iin`, `i`) SELECT ?, ?, ?, IFNULL((SELECT iin+1 FROM eindex WHERE `id`=? ORDER BY `iin` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [tx.hash, time, tx.to, tx.to, tx.to]));
					index.push(mysql.format("INSERT INTO eindex (`hash`, `time`, `id`, `iout`, `i`) SELECT ?, ?, ?, IFNULL((SELECT iout+1 FROM eindex WHERE `id`=? ORDER BY `iout` DESC LIMIT 1), 0), IFNULL((SELECT i+1 FROM eindex WHERE `id`=? ORDER BY `i` DESC LIMIT 1), 0)", [tx.hash, time, tx.from, tx.from, tx.from]));					
					if (tx.status === Utils.TX_STATUS.CONFIRMED){
						tokens_index.push(mysql.format("INSERT INTO tokens_index (`hash`) VALUES (?) ON DUPLICATE KEY UPDATE `txs_count` = `txs_count`+1", [tx.ticker]));
					}
				}
			});
		} else {
			console.trace(`indexes mblocks upgrade disabled`);
		}

		//let sql = [ins, sts.join(';'), pnd.join(';'),index.join(';'), mb].join(';');
		let sql = [index.join(';'), tokens_index.join(';'), mb].join(';');
		return this.transaction(sql);
	}

	async get_account_all(id, page_num, page_size){
		let count = (await this.request(mysql.format("SELECT count(*) AS cnt FROM eindex WHERE `id` = ?", id)))[0].cnt - 1;
		let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		let records = await this.request(mysql.format(`SELECT I.i, I.rectype, I.hash, I.time as time, 
				IF (NOT ISNULL(ik), value, NULL) AS kreward, 
				IF (NOT ISNULL(istat), value, NULL) AS sreward, 
				IF (NOT ISNULL(im), value, NULL) AS mreward, 
				IF (NOT ISNULL(iref), value, NULL) AS refreward, 
				IF (NOT ISNULL(iout), value, NULL) AS output, 
				IF (NOT ISNULL(iin), value, NULL) AS input, 
				MAX(T.status) AS status, T.ticker as token_hash, TKN.fee_type, TKN.fee_value, TKN.fee_min	
			FROM eindex as I
			LEFT JOIN transactions as T ON I.hash = T.hash
			LEFT JOIN tokens as TKN ON T.ticker = TKN.hash
			WHERE id=?
			AND I.i between ? and ?
			GROUP BY I.i ORDER BY I.i DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(Number(count) / page_size), id};
	}

	async get_account_transactions(id, page_num, page_size){
		let count = await this.request(mysql.format(`SELECT itx AS cnt FROM eindex WHERE id = ? AND itx IS NOT NULL ORDER BY itx DESC LIMIT 1`, id));
		let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		if(count[0] === undefined)
			return {balance, id};
		count = count[0].cnt;
		let records = await this.request(mysql.format(`
			SELECT I.i, I.hash, I.time as time, rectype, T.amount, T.data,
				MAX(T.status) AS status, T.ticker as token_hash, TKN.fee_type, TKN.fee_value, TKN.fee_min
			FROM eindex as I
			LEFT JOIN transactions as T ON I.hash = T.hash
			LEFT JOIN tokens as TKN ON T.ticker = TKN.hash
			WHERE id = ?
			AND I.itx between ? and ? 
			GROUP BY I.i ORDER BY I.i DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(Number(count) / page_size), id};
	}

	async get_account_rewards(id, page_num, page_size){
		let count = await this.request(mysql.format(`SELECT irew AS cnt FROM eindex WHERE id = ? AND irew IS NOT NULL ORDER BY irew DESC LIMIT 1`, id));
		let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		if(count[0] === undefined)
			return {balance, id};
		count = count[0].cnt;
		let records = await this.request(mysql.format(`
			SELECT i, irew, I.hash, I.time, I.rectype, I.value as amount, TKN.ticker
			FROM eindex as I
			LEFT JOIN mblocks as M ON I.hash = M.hash
			LEFT JOIN tokens as TKN ON M.token = TKN.hash
			WHERE id = ?
			AND irew between ? and ?
			GROUP BY i ORDER BY i DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(Number(count) / page_size), id};
	}

	async get_account_refreward(id, page_num, page_size){
		let count = await this.request(mysql.format('SELECT `iref` AS cnt FROM eindex WHERE `id` = ? AND `iref` IS NOT NULL ORDER BY `iref` DESC LIMIT 1', id));
		let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		if(count[0] === undefined)
			return {balance, id};
		count = count[0].cnt;
		let records = await this.request(mysql.format(`SELECT i, hash, time, IF (NOT ISNULL(iref), value, NULL) AS refreward
			FROM eindex as I
			WHERE id = ? AND iref between ? and ?
			GROUP BY iref ORDER BY iref DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(count / page_size), id};
	}

	async get_account_in(id, page_num, page_size){
        let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		let count = await this.request(mysql.format('SELECT `iin` AS cnt FROM eindex WHERE `id` = ? AND `iin` IS NOT NULL ORDER BY `iin` DESC LIMIT 1', id));
        if(count[0] === undefined)
            return {balance, id};
        count = count[0].cnt;
		let records = await this.request(mysql.format(`SELECT I.i, I.hash, I.time as time, NULL AS kreward, NULL AS sreward, NULL AS mreward, NULL AS output, amount AS input, MAX(T.status) AS status, T.ticker as token_hash, TKN.fee_type, TKN.fee_value, TKN.fee_min	
			FROM eindex as I
			LEFT JOIN transactions as T ON I.hash = T.hash
			LEFT JOIN tokens as TKN ON T.ticker = TKN.hash
			WHERE id = ?
			AND I.iin between ? and ?
			GROUP BY I.iin ORDER BY I.iin DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(count / page_size), id};
	}

	async get_account_out(id, page_num, page_size){
        let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		let count = await this.request(mysql.format('SELECT `iout` AS cnt FROM eindex WHERE `id` = ? AND `iout` IS NOT NULL ORDER BY `iout` DESC LIMIT 1', id));
        if(count[0] === undefined)
            return {balance, id};
        count = count[0].cnt;
		let records = await this.request(mysql.format(`SELECT I.i, I.hash, I.time as time, NULL AS kreward, NULL AS sreward, NULL AS mreward, amount AS output, NULL AS input, MAX(T.status) AS status, T.ticker as token_hash, TKN.fee_type, TKN.fee_value, TKN.fee_min	
			FROM eindex as I
			LEFT JOIN transactions as T ON I.hash = T.hash
			LEFT JOIN tokens as TKN ON T.ticker = TKN.hash
			WHERE id = ?
			AND I.iout between ? and ?
			GROUP BY I.iout ORDER BY I.iout DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(count / page_size), id};
	}

	async get_account_mreward(id, page_num, page_size){
        let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
        let count = await this.request(mysql.format('SELECT `im` AS cnt FROM eindex WHERE `id` = ? AND `im` IS NOT NULL ORDER BY `im` DESC LIMIT 1', id));
		if(count[0] === undefined)
			return {balance, id};
		count = count[0].cnt;
        let records = await this.request(mysql.format(`SELECT i, hash, time, NULL AS kreward, NULL AS sreward, value AS mreward, NULL AS output, NULL AS input
			FROM eindex
			WHERE id=? AND im between ? and ?
			GROUP BY im ORDER BY im DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));
        return {balance, records, page_count : Math.ceil(count / page_size), id};
	}

	async get_account_sreward(id, page_num, page_size){
        let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
        let count = await this.request(mysql.format('SELECT `istat` AS cnt FROM eindex WHERE `id` = ? AND `istat` IS NOT NULL ORDER BY `istat` DESC LIMIT 1', id));
		if(count[0] === undefined)
			return {balance, id};
		count = count[0].cnt;
        let records = await this.request(mysql.format(`SELECT I.i, I.hash, I.time as time, NULL AS kreward, reward AS sreward, NULL AS mreward, NULL AS output, NULL AS input
			FROM eindex as I
			LEFT JOIN sblocks AS S ON I.hash = S.hash
			WHERE id=?
			AND I.istat between ? and ?
			GROUP BY \`istat\`
			ORDER BY I.istat DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));
        return {balance, records, page_count : Math.ceil(count / page_size), id};
	}

	async get_account_kreward(id, page_num, page_size){
        let balance = await this.request(mysql.format('SELECT amount FROM ledger WHERE `id`=? AND `token` = ?', [id, Utils.ENQ_TOKEN_NAME]));
		balance = balance.length === 1 ? balance[0].amount : 0;
		let count = await this.request(mysql.format('SELECT `ik` AS cnt FROM eindex WHERE `id` = ? AND `ik` IS NOT NULL ORDER BY `ik` DESC LIMIT 1', id));
        if(count[0] === undefined)
            return {balance, id};
        count = count[0].cnt;
		let records = await this.request(mysql.format(`SELECT i, hash, time, value AS kreward, NULL AS sreward, NULL AS mreward, NULL AS output, NULL AS input
			FROM eindex as I
			WHERE id = ? AND ik between ? and ?
			GROUP BY ik ORDER BY ik DESC`,
			[id, count - page_size * page_num - page_size + 1, count - page_size * page_num]));

		return {balance, records, page_count : Math.ceil(count / page_size), id};
	}
	
	async get_balance(id, token){
		let balance = (await this.request(mysql.format(`SELECT L.amount as amount, L.token as token, T.ticker as ticker, T.decimals as decimals
			FROM ledger as L 
			INNER JOIN tokens as T 
			ON T.hash = L.token 
			WHERE L.id = ? AND L.token = ?`, [id, token])))[0];
		return (balance !== undefined) ? balance : ({amount : 0, decimals : 10});
	}

	async get_balance_all(id){
		let balance = await this.request(mysql.format(`SELECT L.amount as amount, L.token as token, T.ticker as ticker, T.decimals as decimals, IFNULL(T.minable, 0) as minable, IFNULL(T.reissuable, 0) as reissuable
			FROM ledger as L 
			INNER JOIN tokens as T 
			ON T.hash = L.token 
			WHERE L.id = ? `, [id]));
		return balance;
	}

	async get_balance_mineable(id){
		let balance = await this.request(mysql.format(`SELECT L.amount as amount, L.token as token, T.ticker as ticker, T.decimals as decimals
			FROM ledger as L 
			INNER JOIN tokens as T 
			ON T.hash = L.token 
			WHERE L.id = ? AND T.minable = 1`, [id]));
		return balance;
	}

	async get_balance_reissuable(id){
		let balance = await this.request(mysql.format(`SELECT L.amount as amount, L.token as token, T.ticker as ticker, T.decimals as decimals
			FROM ledger as L 
			INNER JOIN tokens as T 
			ON T.hash = L.token 
			WHERE L.id = ? AND T.reissuable = 1`, [id]));
		return balance;
	}

	async get_accounts(ids){
		if(!ids.length)
			return [];
		let res = await this.request(mysql.format('SELECT * FROM ledger WHERE id in (?) AND `token` = ?', [ids, Utils.ENQ_TOKEN_NAME]));
		return res;
	}

	async get_accounts_all(ids){
		if(!ids.length)
			return [];
		let res = await this.request(mysql.format('SELECT * FROM ledger WHERE id in (?)', [ids]));
		return res;
	}

	async get_tokens_all(hashes){
		if(!hashes.length)
			return [];
		let res = await this.request(mysql.format(`SELECT tokens.*, IFNULL(txs_count, 0) as txs_count
														FROM tokens
														LEFT JOIN tokens_index ON tokens.hash = tokens_index.hash 
														WHERE tokens.hash in (?)`, [hashes]));
		return res;
	}

	async put_token(data){
		let res = await this.request(mysql.format(`INSERT INTO tokens SET ?`, [data]));
		return res;
	}

	async get_top_accounts(page_num, page_size, token_hash){
    	if(token_hash === undefined)
    		token_hash = Utils.ENQ_TOKEN_NAME;
        let total = (await this.request(mysql.format('SELECT SUM(amount) as `total` FROM ledger WHERE `token` = ?', token_hash)))[0].total;
        let count = (await this.get_accounts_count(token_hash)).count;
        let res = await this.request(mysql.format(`SELECT ledger.id,
			ledger.amount + IF(token = '${Utils.ENQ_TOKEN_NAME}',
				(IFNULL(sum(delegates.amount),0) +
				IFNULL(sum(delegates.reward),0)),
				0) as amount,
			token
			FROM ledger 
			LEFT JOIN delegates ON ledger.id = delegates.delegator
			WHERE token = ? 
			GROUP BY delegates.delegator, ledger.id
			ORDER BY amount DESC LIMIT ?, ?`, [token_hash, page_num * page_size, page_size]));
        return {total:total, accounts:res, page_count : Math.ceil(Number(count / page_size))};
    }

    async get_token_info_page(page_num, page_size, type){
		let where = '';
		let count_info = await this.get_tokens_count();
		let count = count_info.count;

		switch (type) {
			case 'minable':
				where = ` WHERE minable = 1 `;
				count = count_info.minable;
				break;
			case 'reissuable':
				where = ` WHERE reissuable = 1 `;
				count = count_info.reissuable;
				break;
			case 'non_reissuable':
				where = ` WHERE minable = 0 AND reissuable = 0 `;
				count = count_info.non_reissuable;
				break;
			default:
				break;
		}

		let owner_slots = await this.get_mining_tkn_owners(this.app_config.mblock_slots.count - this.app_config.mblock_slots.reserve.length, this.app_config.mblock_slots.reserve, this.app_config.mblock_slots.min_stake);
		owner_slots = owner_slots.concat(this.app_config.mblock_slots.reserve.map(function(item) {
			return {id:item};
		}));
		let in_slot = '0';
		if(owner_slots.length > 0)
			in_slot = mysql.format(`IF(owner in (?) AND minable = 1, 1, 0)`, [owner_slots.map(item => item.id)]);

        let res = await this.request(mysql.format(`SELECT tokens.hash as token_hash, total_supply, fee_type, fee_value, fee_min, decimals, minable, reissuable,
														(SELECT count(amount) FROM ledger WHERE ledger.token = tokens.hash) as token_holders_count,
														IFNULL(txs_count, 0) as txs_count,
														${in_slot} as in_slot
														FROM tokens 
														LEFT JOIN tokens_index ON tokens.hash = tokens_index.hash
														${where}
														GROUP BY tokens.hash
														ORDER BY token_holders_count DESC, token_hash LIMIT ?, ?`, [page_num * page_size, page_size]));
        return {tokens:res, page_count : Math.ceil(Number(count) / page_size)};
    }

    async get_tokens_by_owner(owner){
        let res = await this.request(mysql.format('SELECT hash as token_hash, total_supply, fee_type, fee_value, fee_min, reissuable, minable FROM tokens WHERE owner = ? ORDER BY hash DESC ', [owner]));
        return res;
    }

	async get_minable_tokens_by_owner(owner){
		let res = await this.request(mysql.format('SELECT hash FROM tokens WHERE owner = ? and minable = true ORDER BY hash DESC ', [owner]));
		return res;
	}

	async get_tx(hash){
		return await this.request(mysql.format(`SELECT T.status, T.from, T.to, T.amount as total_amount, TKN.fee_min, T.ticker as token_hash, TKN.fee_value, TKN.fee_type, T.data, T.hash, M.kblocks_hash, M.hash as mblocks_hash
													FROM transactions as T
													INNER JOIN (SELECT MAX(status) AS status
														FROM transactions
														WHERE transactions.hash = ?
													   GROUP BY hash) MaxStatus ON MaxStatus.status = T.status and  T.hash = ?
													INNER JOIN tokens AS TKN ON TKN.hash = T.ticker
													INNER JOIN mblocks AS M ON M.hash = T.mblocks_hash`, [hash,hash]));
	}

	async get_duplicates(hashes){
		if (hashes.length > 0) {
			return await this.request(mysql.format('SELECT DISTINCT transactions.hash, mblocks.included AS included FROM transactions LEFT JOIN mblocks ON mblocks.hash = transactions.mblocks_hash WHERE transactions.`hash` IN (?) AND `calculated` = 1 GROUP BY transactions.hash', [hashes]));
		} else {
			return [];
		}
	}

	async get_indexed_duplicates(hashes){
		if (hashes.length > 0) {
			return await this.request(mysql.format('SELECT DISTINCT transactions.hash, mblocks.included AS included FROM transactions LEFT JOIN mblocks ON mblocks.hash = transactions.mblocks_hash WHERE transactions.`hash` IN (?) AND `indexed` = 1 GROUP BY transactions.hash', [hashes]));
		} else {
			return [];
		}
	}

	async get_cashier_pointer(){
		let sql = mysql.format("SELECT `value` FROM stat WHERE `key` = 'cashier_ptr'");
		let res = await this.request(sql);

		if (res[0])
			return res[0].value;
		else return null;
	}

	async get_indexer_pointer(){
		let sql = mysql.format("SELECT `value` FROM stat WHERE `key` = 'indexer_ptr'");
		let res = await this.request(sql);

		if (res[0])
			return res[0].value;
		else return null;
	}

	//TODO возвращать блоки из нужной ветки
	async get_kblock(hash){
		return this.request(mysql.format('SELECT * FROM kblocks WHERE `hash` = ?', hash));
	}

	async get_next_block(hash) {
		let res = (await this.request(mysql.format('SELECT * FROM kblocks WHERE `link` = ? AND `hash` <> `link`', hash)));

		if (res.length > 0) {
			return res[0];
		} else {
			return null;
		}
	}

	async update_max_tps(max_tps){
		await this.request(mysql.format("INSERT INTO stat (`key`, `value`) VALUES ('max_tps', ?) ON DUPLICATE KEY UPDATE `value` =  IF(CAST(`value` AS UNSIGNED) > CAST(VALUES(value) AS UNSIGNED), `value`, VALUES(value))", max_tps));
	}

	reset_poa_count(){
		return this.transaction("DELETE FROM clients WHERE `type`=2; DELETE FROM poalist WHERE NOT ISNULL(id);");
	}

	get_unresolved_ips(){
		return this.request(`SELECT clients.ipstring FROM clients 
							LEFT JOIN iptable ON substring_index(clients.ipstring,':', '1') = iptable.ipstring
							WHERE (ISNULL(city) OR ISNULL(country) OR ISNULL(lat) OR ISNULL(lon)) 
							AND clients.ipstring NOT LIKE '%127.0.0.1%' 
							AND clients.ipstring NOT LIKE 'localhost%';`);
	}

	update_iptable(values){
		if (values.length > 0) {
			let sql = mysql.format(`INSERT INTO iptable (ipstring, country, country_code, city, lat, lon) VALUES ? 
                ON DUPLICATE KEY UPDATE lat = VALUES(lat), lon=VALUES(lon), country=VALUES(country), country_code=VALUES(country_code), city=VALUES(city);`, values);
			return this.request(sql);
		}
	}

	async update_clients(ip, value, type){
		let r = await this.request(mysql.format("INSERT INTO clients (`ipstring`, `count`, `type`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `count`=GREATEST(0,`count`+ (?));", [ip, value === 1 ? 1 : 0, type, value]));
		return r;
	}

	set_client_state(ip, pub, value){
		let r = this.request(mysql.format("INSERT INTO clients (`ipstring`, `pub`, `count`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `pub` = ?, `count` = ?;", [ip, pub, value, pub, value]));
		return r;
	}

	set_client_type(ip, pub, type){
		let r = this.request(mysql.format("INSERT INTO clients (`ipstring`, `pub`, `type`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `pub` = ?, `type` = ?;", [ip, pub, type, pub, type]));
		return r;
	}

	add_client(ip, pub, value, type){
		let r = this.request(mysql.format("INSERT INTO clients (`ipstring`, `pub`, `count`, `type`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `pub` = ?, `count` = ?, `type` = ?;", [ip, pub, value, type, pub, value, type]));
		return r;
	}

	get_hosts_online(){
		let r = this.request(mysql.format("SELECT * FROM clients WHERE `count` = 1 AND `type` != 2;"));
		return r;
	}

	async get_clients(){
		return this.request(`SELECT clients.type, iptable.city, iptable.lat, iptable.lon, SUM(count) as count FROM clients 
							LEFT JOIN iptable ON substring_index(clients.ipstring,':', '1') = iptable.ipstring
							WHERE count <> 0 
							GROUP BY iptable.city, clients.type;`);
	}

	pending_add(txs){
		return this.request(mysql.format("INSERT IGNORE INTO pending (`hash`, `from`, `to`, `amount`, `nonce`, `sign`, `ticker`, `data`) VALUES ?", [txs.map((tx) => [tx.hash, tx.from, tx.to, tx.amount, tx.nonce, tx.sign, tx.ticker, tx.data])]));
	}

	register_client(client){
		return this.request(mysql.format("INSERT INTO poalist (`id`, `ip`) VALUES (?, ?)", [client.id, client.ip]));
	}

	update_client(client){
		return this.request(mysql.format("UPDATE poalist SET `pubkey`=? WHERE `id` = ?;", [client.pubkey, client.id]));
	}

	unregister_client(client){
		return this.request(mysql.format("DELETE FROM poalist WHERE `id`=?", [client.id]));
	}

	async get_clients_list(){
		return this.request(mysql.format("SELECT `pubkey` AS `key`, `country` AS `country_name`, `country_code` AS `country_code` FROM poalist LEFT JOIN iptable ON iptable.ipstring = poalist.ip WHERE NOT ISNULL(`pubkey`);"));
	}

	pending_peek(count, timeout_sec) {
		let uid = Math.floor(Math.random() * 1e15);
		console.silly(`pending uid = ${uid}`);
		return this.request(mysql.format("UPDATE pending SET `counter` = `counter` + 1, `lastrequested` = NOW(), `uid` = ? WHERE ISNULL(`lastrequested`) OR `lastrequested` < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ? SECOND) ORDER BY `counter`, `lastrequested` ASC LIMIT ?", [uid, timeout_sec || 60, count]))
			.then((rows) => {
				if (rows.affectedRows > 0){
					return this.request(mysql.format("SELECT `hash`, `from`, `to`, `amount`, `nonce`, `sign`, `ticker`, `data` FROM pending WHERE `uid`=?", uid));
				} else {
					return [];
				}
			});
	}

	async get_ledger(){
		let res = await this.request(mysql.format('SELECT * FROM ledger WHERE `token` = ?', Utils.ENQ_TOKEN_NAME));
		return res;
	}

	async get_referrals_count(id){
		let res = await this.request(mysql.format(`SELECT SUM(reward) AS ref_reward, COUNT(publisher) AS ref_count 
		FROM (SELECT mblocks.publisher, SUM(mblocks.reward) AS reward 
		FROM eindex LEFT JOIN mblocks ON mblocks.hash = eindex.hash WHERE id = ? 
		AND mblocks.publisher <> id 
		AND NOT ISNULL(iref) 
		AND time > unix_timestamp() - 24*60*60 
		GROUP BY mblocks.publisher) AS t;`, id));
		return res[0];
	}

	async get_krewards(id){
		let res = await this.request(mysql.format(`SELECT  SUM(reward) AS k_reward
        FROM (SELECT kblocks.publisher, SUM(kblocks.reward) AS reward
		FROM eindex LEFT JOIN kblocks ON kblocks.hash = eindex.hash WHERE id = ?
		AND NOT ISNULL(ik) 
		AND eindex.time > unix_timestamp() - 24*60*60 
		GROUP BY kblocks.publisher) AS t;`, id));
		return res[0];  
	}

	async get_srewards(id){
		let res = await this.request(mysql.format(`SELECT  SUM(reward) s_reward
		FROM (SELECT sblocks.publisher, SUM(sblocks.reward) AS reward
		FROM eindex LEFT JOIN sblocks ON sblocks.hash = eindex.hash WHERE id = ?
		AND NOT ISNULL(istat) 
		AND time > unix_timestamp() - 24*60*60 
		GROUP BY sblocks.publisher) AS t;`, id));
		return res[0];  
	}

	async put_agent_info(info){
		let res = await this.request(mysql.format('INSERT INTO agents (`id`, `ref_count`, `ref_reward`, `k_reward`, `s_reward`, `lastcalc`) ' +
			'VALUES (?, ?, ?, ?, ?, UNIX_TIMESTAMP()) ' +
			'ON DUPLICATE KEY UPDATE `id` = VALUES(id), `ref_count` = VALUES(ref_count), `ref_reward` = VALUES(ref_reward), `k_reward` = VALUES(k_reward), `s_reward` = VALUES(s_reward), `lastcalc` = UNIX_TIMESTAMP()',
			[info.id, info.ref_count, info.ref_reward, info.k_reward, info.s_reward]));
	}

	async get_agent_info(id){
		let res = await this.request(mysql.format('SELECT * FROM agents WHERE id = ?', id));
		return res[0];
	}

	async get_top_pos(){
		let r = this.request(mysql.format("SELECT agents.id as id, ledger.amount as stake, agents.s_reward FROM agents JOIN ledger on ledger.id = agents.id WHERE agents.s_reward > 0"));
		return r;
	}

	async get_pos_contract_count(){
		let cnt = (await this.request(mysql.format("SELECT count(*) as count FROM poses")))[0];
		return cnt;
	}

	async get_pos_contract_all(){
		let res = this.request(mysql.format("SELECT * FROM poses"));
		return res;
	}

	async get_pos_info(pos_ids){
		if(pos_ids.length === 0)
			return [];
		let data = await this.request(mysql.format(`SELECT D.pos_id, owner, fee, sum(D.amount) as stake, DD.amount AS self_del FROM poses AS P 
			INNER JOIN delegates AS D
			LEFT JOIN delegates AS DD ON DD.pos_id = D.pos_id AND DD.delegator = P.owner 
			WHERE D.pos_id IN (?) 
			AND D.pos_id = P.id 
			GROUP BY D.pos_id`, [pos_ids]));
		return data;
	}

	async get_kblock_txs_count(hash){
		let data = (await this.request(mysql.format(`SELECT count(*) as count FROM transactions as T
			left join mblocks as M on T.mblocks_hash = M.hash
			left join kblocks as K on K.hash = M.kblocks_hash
			where K.hash = ? and status = 3`, [hash])))[0];
		return data.count;
	}

	async get_pos_total_stake(){
		let data = (await this.request(mysql.format('SELECT sum(amount) as total_stake FROM delegates')))[0];
        return data;
	}

	async get_pos_active_total_stake(){
		let data = (await this.request(mysql.format('SELECT sum(amount) as active_total_stake FROM delegates LEFT JOIN poses ON poses.id = delegates.pos_id WHERE uptime > 0')))[0];
        return data;
	}

	async get_pos_contract_info_page(page_num, page_size){
		let count = (await this.get_pos_contract_count()).count;
		let token_enq = (await this.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];

		let i = page_size*page_num;
		let pos_rew = (BigInt(token_enq.block_reward) * BigInt(this.app_config.reward_ratio.pos)) / Utils.PERCENT_FORMAT_SIZE;
		let year_blocks_count = 60 / this.app_config.target_speed * 60 * 24 * 365; 
        let res = await this.request(mysql.format(`SELECT @i := @i + 1 AS rank,  pos_id, owner, fee, stake, stake_power, IF(uptime > 0, (stake / @active_total_stake), 0)  as active_stake_power, IFNULL(ROUND(((? * (stake / @active_total_stake) * (1e4 - fee) * (uptime / 5760) / 1e4 * ?)/stake*1e4),0),0) as roi FROM ( 
						(SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
						(SELECT @active_total_stake:=IFNULL((SELECT sum(amount) as active_total_stake FROM delegates LEFT JOIN poses ON poses.id = delegates.pos_id WHERE uptime > 0),0)) AS active_total_stake, 
						(SELECT id as pos_id, owner, fee, uptime, @stake := IFNULL((SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC) as t,
						(SELECT @i:=?) AS iterator
						) LIMIT ?, ?`,[pos_rew, year_blocks_count, i,  page_num * page_size, page_size]));
        return {pos_contracts:res, page_count : Math.ceil(count / page_size)};
    }

    async get_pos_contract_info(pos_id){
		let i = 0;
		let token_enq = (await this.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];

		let pos_rew = (BigInt(token_enq.block_reward) * BigInt(this.app_config.reward_ratio.pos)) / Utils.PERCENT_FORMAT_SIZE;
		let year_blocks_count = 60 / this.app_config.target_speed * 60 * 24 * 365; 
        let res = await this.request(mysql.format(`SELECT * FROM(SELECT @i := @i + 1 AS rank, IFNULL(uptime > 0,0) as active, pos_id, owner, name, fee, stake, stake_power, IF(uptime > 0, (stake / @active_total_stake), 0)  as active_stake_power, IFNULL(ROUND(((? * (stake / @active_total_stake)  * (1e4 - fee) * (uptime / 5760)/ 1e4 * ?)/stake*1e4),0),0) as roi, IF(uptime > 0, 0,(stake/(@active_total_stake+stake))) as active_stake_share, IFNULL(uptime/5760,0) as uptime FROM ( 
						(SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
						(SELECT @active_total_stake:=IFNULL((SELECT sum(amount) as active_total_stake FROM delegates LEFT JOIN poses ON poses.id = delegates.pos_id WHERE uptime > 0),0)) AS active_total_stake, 
						(SELECT id as pos_id, owner, fee, uptime, name, @stake := IFNULL((SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, CAST((@stake / @total_stake) as DECIMAL(10,2)) as stake_power FROM poses ORDER BY stake DESC) as t,
						(SELECT @i:=?) AS iterator
						)) as pos_list WHERE pos_id = ?`,[pos_rew, year_blocks_count, i, pos_id]));
        return res;
    }

	async get_avg_block_time(count){
		if(!Number.isInteger(count))
			return 0;
		let time = (await this.request(mysql.format(`SELECT sum(tm) as time FROM (
			SELECT kblocks.time - BEF.time tm FROM trinity.kblocks 
			LEFT JOIN kblocks BEF ON kblocks.link = BEF.hash
			WHERE kblocks.n < (SELECT n FROM kblocks WHERE hash = (SELECT stat.value FROM stat WHERE stat.key = 'cashier_ptr'))
			ORDER BY kblocks.n DESC LIMIT ?) as T`, [count])))[0].time;
		return time / count;
	}

    async get_pos_contract_info_all(){
		let token_enq = (await this.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];

		let pos_rew = (BigInt(token_enq.block_reward) * BigInt(this.app_config.reward_ratio.pos)) / Utils.PERCENT_FORMAT_SIZE;
		let year_blocks_count = 60 / this.app_config.target_speed * 60 * 24 * 365; 
		// TODO: Can be replaced by  get_avg_block_time
		let last_blocks_time = (await this.request(mysql.format(`SELECT sum(tm) as time FROM (
																SELECT kblocks.time - BEF.time tm FROM trinity.kblocks 
																LEFT JOIN kblocks BEF ON kblocks.link = BEF.hash
																WHERE kblocks.n < (SELECT n FROM kblocks WHERE hash = (SELECT stat.value FROM stat WHERE stat.key = 'cashier_ptr'))
																ORDER BY kblocks.n DESC LIMIT 100) as T`)))[0].time;
		let statistic_year_blocks_count = 0;
		if (last_blocks_time !== null)
			statistic_year_blocks_count = 60 * 60 * 24 * 100 * 365 / Number(last_blocks_time);
		let sql = mysql.format(`SELECT @i := @i + 1 AS rank, IFNULL(uptime > 0,0) as active, pos_id, owner, fee, stake, stake_power, IF(uptime > 0, (stake / @active_total_stake) , 0)  as active_stake_power, IFNULL(ROUND(((? * (stake / @active_total_stake) * (1e4 - fee) * (uptime / 5760) / 1e4 * ?)/stake*1e4),0),0) as roi, IF(uptime > 0, 0,(stake/(@active_total_stake+stake))) as active_stake_share, IFNULL((uptime/5760),0) as uptime FROM (
						(SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake,
						(SELECT @active_total_stake:=IFNULL((SELECT sum(amount) as active_total_stake FROM delegates LEFT JOIN poses ON poses.id = delegates.pos_id WHERE uptime > 0),0)) AS active_total_stake,
						(SELECT id as pos_id, owner, fee, uptime, @stake := IFNULL((SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC) as t,
						(SELECT @i:= 0) AS iterator
						)`,[pos_rew, statistic_year_blocks_count])
		let pos_contracts = await this.request(sql);
        return {pos_contracts};
    }

    async get_pos_contract_list(owner){
    	let res = await this.request(mysql.format('SELECT id as pos_id, owner, fee, IFNULL((SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, name FROM poses WHERE poses.owner = ? ORDER BY id DESC', [owner]));
        return res;
    }
	async get_top_poses(size){
		let res = await this.request(mysql.format('SELECT pos_id, sum(amount) AS power FROM delegates GROUP BY pos_id ORDER BY power DESC LIMIT ?', [size]));
		return res;
	}
/*
    async get_pos_contract_info(pos_id){
    	let res = await this.request(mysql.format('SELECT id as pos_id, owner, fee, IFNULL((SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, name FROM poses WHERE poses.id = ? ORDER BY id DESC', [pos_id]));
        return res;
    }
*/
	async get_pos_delegates(pos_id, delegators){
		let res = this.request(mysql.format("SELECT * FROM delegates WHERE pos_id = ? AND delegator IN (?)", [pos_id, delegators]));
		return res;
	}

	async get_pos_delegators(pos_id){
		let res = this.request(mysql.format("SELECT * FROM delegates WHERE pos_id = ?", pos_id));
		return res;
	}

	async get_pos_delegators_page(pos_id, page_num, page_size){
		let data = (await this.request(mysql.format("SELECT sum(amount) as total_stake, count(*) as count FROM delegates WHERE pos_id = ?", pos_id)))[0];
		let res = await this.request(mysql.format("SELECT delegator, amount, amount/? as share FROM delegates WHERE pos_id = ? ORDER BY amount DESC LIMIT ?, ?", [data.total_stake, pos_id, page_num * page_size, page_size]));
		return {pos_delegators:res, page_count : Math.ceil(data.count / page_size)};
	}

	async get_pos_delegated_list(delegator){
		let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let delegated = await this.request(mysql.format(`SELECT contracts.*, delegated, 0 as undelegated, 0 as transit, reward FROM
								(SELECT @i := @i + 1 AS rank,  pos_id, owner, fee, stake, stake_power FROM (
								 (SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
								 (SELECT id as pos_id, owner, fee, @stake := IFNULL(
								 (SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC, pos_id DESC) as t, 
								 (SELECT @i:=0) AS iterator
								)) as contracts
								RIGHT JOIN
								(SELECT pos_id, amount as delegated, reward
									FROM delegates
								    WHERE (amount > 0 OR reward > 0) AND delegator = ?
								) DEL
								ON DEL.pos_id = contracts.pos_id`, [delegator]));
		let undelegated = await this.request(mysql.format(`SELECT contracts.*, 0 as delegated, undelegated, transit, 0 as reward FROM
								(SELECT @i := @i + 1 AS rank,  pos_id, owner, fee, stake, stake_power FROM (
								 (SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
								 (SELECT id as pos_id, owner, fee, @stake := IFNULL(
								 (SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC, pos_id DESC) as t, 
								 (SELECT @i:=0) AS iterator						
								)) as contracts
								RIGHT JOIN
								(SELECT pos_id, sum(if(undelegates.height <= ?, undelegates.amount, 0 ))  as undelegated , sum(if(undelegates.height > ?, undelegates.amount, 0 ))  as transit
									FROM undelegates left join transactions on undelegates.id = transactions.hash 
								    WHERE undelegates.amount > 0 AND transactions.from = ? AND transactions.status = 3
								    GROUP BY pos_id
								) UN
								ON UN.pos_id = contracts.pos_id`, [height, height, delegator]));
		

		let tmp = undelegated.filter(element => {
			let item = delegated.find(x=> x.pos_id === element.pos_id); 
			if(item !== undefined){
				item.undelegated = element.undelegated;
				item.transit = element.transit;
				return false;
			}else
				return true;
		});

        let res = delegated.concat(tmp);
        return res;
	}

	async get_pos_delegated_page(delegator, page_num, page_size){
		let count = (await this.request(mysql.format('SELECT count(*) as count FROM delegates WHERE delegator = ?', [delegator])))[0].count;
        
		let height = (await this.get_mblocks_height()).height - this.app_config.transfer_lock;
		let delegated = await this.request(mysql.format(`SELECT contracts.*, delegated, 0 as undelegated, 0 as transit, reward FROM
								(SELECT @i := @i + 1 AS rank,  pos_id, owner, fee, stake, stake_power FROM (
								 (SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
								 (SELECT id as pos_id, owner, fee, @stake := IFNULL(
								 (SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC, pos_id DESC) as t, 
								 (SELECT @i:=0) AS iterator
								)) as contracts
								RIGHT JOIN
								(SELECT pos_id, amount as delegated, reward
									FROM delegates
								    WHERE (amount > 0 OR reward > 0) AND delegator = ?
								) DEL
								ON DEL.pos_id = contracts.pos_id`, [delegator]));
		let undelegated = await this.request(mysql.format(`SELECT contracts.*, 0 as delegated, undelegated, transit, 0 as reward FROM
								(SELECT @i := @i + 1 AS rank,  pos_id, owner, fee, stake, stake_power FROM (
								 (SELECT @total_stake:=IFNULL((SELECT sum(amount) FROM delegates),0)) AS total_stake, 
								 (SELECT id as pos_id, owner, fee, @stake := IFNULL(
								 (SELECT sum(amount) FROM delegates WHERE poses.id = delegates.pos_id),0) as stake, (@stake / @total_stake) as stake_power FROM poses ORDER BY stake DESC, pos_id DESC) as t, 
								 (SELECT @i:=0) AS iterator
								)) as contracts
								RIGHT JOIN
								(SELECT pos_id, sum(if(undelegates.height <= ?, undelegates.amount, 0 ))  as undelegated , sum(if(undelegates.height > ?, undelegates.amount, 0 ))  as transit
									FROM undelegates left join transactions on undelegates.id = transactions.hash 
								    WHERE undelegates.amount > 0 AND transactions.from = ? AND transactions.status = 3
								    GROUP BY pos_id
								) UN
								ON UN.pos_id = contracts.pos_id LIMIT ?,?`, [height, height, delegator, page_num * page_size, page_size]));
		

		let tmp = undelegated.filter(element => {
			let item = delegated.find(x=> x.pos_id === element.pos_id); 
			if(item !== undefined){
				item.undelegated = element.undelegated;
				item.transit = element.transit;
				return false;
			}else
				return true;
		});

		//console.info({delegated.length);
		//console.info({tmp.length});
        let res = delegated.concat(tmp);



        return {pos_delegated:res, page_count : Math.ceil(count / page_size)};
    }

	async get_delegated_balance(delegator){
		let data = (await this.request(mysql.format('SELECT sum(amount) as delegated, sum(reward) as reward FROM delegates WHERE delegator = ?', [delegator])))[0]; 
        if(data.delegated === null) 
        	 data.delegated = 0; 
        if(data.reward === null) 
        	data.reward = 0; 
        return data; 
	}

	async get_pos_delegates_all(){
		let res = this.request(mysql.format("SELECT * FROM delegates"));
		return res;
	}

	async get_pos_undelegates(id){
		let res = this.request(mysql.format("SELECT * FROM undelegates WHERE id = ?", [id]));
		return res;
	}

	async get_pos_undelegated_list(delegator){
		let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let res = await this.request(mysql.format(`SELECT id as tx_hash, pos_id, U.amount, kblocks.n as height, kblocks.time as timestamp,  U.height > ? as transfer_lock
			FROM undelegates U
			LEFT JOIN kblocks ON U.height = kblocks.n
			LEFT JOIN transactions ON  U.id = transactions.hash
			WHERE transactions.from = ? AND transactions.status = 3 AND U.amount > 0 ORDER BY U.amount DESC;`, [height, delegator]));


        return res;
	}

	async get_pos_undelegated_page(delegator, page_num, page_size){
		let count = (await this.request(mysql.format(`SELECT count(*) as count
			FROM undelegates U
			LEFT JOIN transactions ON  U.id = transactions.hash
			WHERE U.amount > 0 AND transactions.from = ? AND transactions.status = 3`, [delegator])))[0].count;

		let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let res = await this.request(mysql.format(`SELECT id as tx_hash, pos_id, U.amount, kblocks.n as height, kblocks.time as timestamp,  U.height > ? as transfer_lock
			FROM undelegates U
			LEFT JOIN kblocks ON U.height = kblocks.n
			LEFT JOIN transactions ON  U.id = transactions.hash
			WHERE U.amount > 0 AND transactions.from = ? AND transactions.status = 3 ORDER BY U.amount DESC LIMIT ?, ?;`, [height, delegator, page_num * page_size, page_size]));
        return {pos_undelegated:res, page_count : Math.ceil(count / page_size)};
	}

	async get_undelegated_balance(delegator){
	 	let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let data = (await this.request(mysql.format('SELECT sum(undelegates.amount) as undelegated FROM undelegates left join transactions on undelegates.id = transactions.hash WHERE transactions.from = ? AND transactions.status = 3 AND undelegates.height <= ?', [delegator, height])))[0];
        return (data.undelegated !== null) ? data.undelegated : 0;
	}

	async get_transit_balance(delegator){
		let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let data = (await this.request(mysql.format('SELECT sum(undelegates.amount) as transit FROM undelegates left join transactions on undelegates.id = transactions.hash WHERE transactions.from = ? AND transactions.status = 3 AND undelegates.height > ?', [delegator, height])))[0];
        return (data.transit !== null) ? data.transit : 0;
	}

	async get_tx_count(limit){
		let height = (await this.get_mblocks_height()).height - (this.app_config.transfer_lock);
		let data = (await this.request(mysql.format('SELECT sum(undelegates.amount) as transit FROM undelegates left join transactions on undelegates.id = transactions.hash WHERE transactions.from = ? AND transactions.status = 3 AND undelegates.height > ?', [delegator, height])))[0];
		return (data.transit !== null) ? data.transit : 0;
	}

	async get_pos_names(){
		let res = this.request(mysql.format("SELECT id as pos_id, name FROM poses"));
		return res;
	}

	async put_tx_data(chunks){
		let next_chunk = null;
		for(let i = (chunks.length - 1); i >= 0; i--){
			let res = await this.request(mysql.format("INSERT IGNORE INTO txs_data (`data`, `next_chunk`) VALUES (?)", [[chunks[i], next_chunk]]));
			next_chunk = res.insertId;
		}
		return next_chunk;
	}
	async get_tx_data(hash){
		let next_chunk = (await this.request(mysql.format('SELECT `data` FROM transactions WHERE hash = ?', hash)))[0].data;
		let data = [];
		while(next_chunk !== null){
			let res = (await this.request(mysql.format('SELECT * FROM txs_data WHERE chunk_id = ?', next_chunk)))[0];
			data.push(res.data);
			next_chunk = res.next_chunk;
		}
		return data;
	}

	async get_rois(){
		let res = this.request(mysql.format("SELECT token, calc_stakes, calc_rois, calc_rois_sim FROM rois"));
		return res;
	}

	async update_roi(token, rois, rois_sim){
		let res = this.request(mysql.format("UPDATE rois SET calc_rois = ?, calc_rois_sim = ? WHERE token = ?", [rois, rois_sim, token]));
		return res;
	}
}

module.exports.DB = DB;
