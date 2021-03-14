/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Utils.js
 * Utility functions
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const crypto = require('crypto');
const enq = require('./Enq');
const config = require('./config.json');
const rsasign = require('jsrsasign');
let rx = require('./node_modules/node-randomx/addon');
const fs = require('fs');

let KeyEncoder = require('key-encoder').default;
let keyEncoder = new KeyEncoder('secp256k1');

class ECC {
	constructor(mode) {
		if(mode === "short"){
			this.a = enq.BigNumber(25);
			this.b = enq.BigNumber(978);
			this.p = enq.BigNumber(1223);
			this.order = enq.BigNumber(1183);
			this.g0x = enq.BigNumber(972);
			this.g0y = enq.BigNumber(795);
			this.gx = enq.BigNumber(1158);
			this.gy = enq.BigNumber(92);
			this.curve = enq.Curve(this.a, this.b, this.p, this.order, this.g0x, this.g0y);
			this.G0 = enq.Point(this.g0x, this.g0y, this.curve);
			this.G = enq.Point(this.gx, this.gy, this.curve);
			this.MPK = enq.Point(enq.BigNumber(512), enq.BigNumber(858), this.curve);
		}
		else{
			this.a = 	enq.BigNumber(1);
			this.b = 	enq.BigNumber(0);
			this.p = 	enq.BigNumber("80000000000000000000000000000000000200014000000000000000000000000000000000010000800000020000000000000000000000000000000000080003");
			this.order = enq.BigNumber("80000000000000000000000000000000000200014000000000000000000000000000000000010000800000020000000000000000000000000000000000080004");
			this.g0x = 	enq.BigNumber("2920f2e5b594160385863841d901a3c0a73ba4dca53a8df03dc61d31eb3afcb8c87feeaa3f8ff08f1cca6b5fec5d3f2a4976862cf3c83ebcc4b78ebe87b44177");
			this.g0y = 	enq.BigNumber("2c022abadb261d2e79cb693f59cdeeeb8a727086303285e5e629915e665f7aebcbf20b7632c824b56ed197f5642244f3721c41c9d2e2e4aca93e892538cd198a");

			this.G0_fq = {
				"x" : "1 1971424652593645857677685913504949042673180456464917721388355467732670356866868453718540344482523620218083146279366045128738893020712321933640175997249379 4296897641464992034676854814757495000621938623767876348735377415270791885507945430568382535788680955541452197460367952645174915991662132695572019313583345",
				"y" : "1 5439973223440119070103328012315186243431766339870489830477397472399815594412903491893756952248783128391927052429939035290789135974932506387114453095089572 3254491657578196534138971223937186183707778225921454196686815561535427648524577315556854258504535233566592842007776061702323300678216177012235337721726634"
			};
			this.curve = enq.Curve(this.a, this.b, this.p, this.order, this.g0x, this.g0y);
			this.strIrred = "2 1 1 6703903964971298549787012499102923063739684112761466562144343758833001675653841939454385015500446199477853424663597373826728056308768000892499915006541826";
			this.strA = "0 1";
			this.strB = "0 0";
			this.e_fq = enq.Curve_Fq(this.p.decString(), 2, this.strIrred, this.strA, this.strB);
		}
	}
}

function apiRequest(options){
    let request = require('request');
    return new Promise(function(resolve, reject){
        request(options, (err, res, body) => {
            if (err) {
                return reject(new Error('apiRequest error : ' + err));
            }
            if(!body)
                return resolve(null);
            if(options.method === 'GET')
                try {
                    body = JSON.parse(body);
                }
                catch (err) {
                    return reject(new Error('apiRequest parse error : ' + err));
                }
            return resolve(body);
        });
    });
}

let utils = {
	ENQ_TOKEN_NAME : config.native_token_hash,
	TX_STATUS : {
		DUPLICATE : 1,
		REJECTED  : 2,
		CONFIRMED : 3
	},
	MAX_SUPPLY_LIMIT : BigInt('18446744073709551615'),
	PERCENT_FORMAT_SIZE : BigInt(10000),
	MINER_INTERVAL : 1000,
	POS_RESEND_MINER_INTERVAL : 30000,
	MINER_CHECK_TARGET_INTERVAL : 100,
	MAX_COUNT_NOT_COMPLETE_BLOCK : 10,
	PID_TIMEOUT : 10, //sec
	SYNC_CHUNK_SIZE : 1000000, //byte
	SYNC_FAILURES_LIMIT : 5,
	SYNC_IGNORE_TIMEOUT : 7200000, //ms  2 hours

	pid_cached : 0,
	lastTime : Date.now(),
	lastInput : 0,
	lastError : 0,
	ITerm : 0,
	ki : 0.01,
	kp : 16777215 * 0.5, //
	kd : 16777215 * 0.1,

	outMax : 16777215 * 2,
	outMin : 16777215 * -2,
	ecdsa_verify : function(cpkey, sign, msg){
		try{
			let sign_buf = Buffer.from(sign, 'hex');
			let pkey = crypto.ECDH.convertKey(cpkey, 'secp256k1', 'hex', 'hex', 'uncompressed');
			let pemPublicKey = keyEncoder.encodePublic(pkey, 'raw', 'pem');

			const verify = crypto.createVerify('SHA256');
			verify.update(msg);
			verify.end();
			return verify.verify(pemPublicKey, sign_buf);
		}
		catch(err){
			console.error("Verification error: ", err);
			console.error({sign});
			return false;
		}
	},
	ecdsa_sign : function(skey, msg){
		let sig = new rsasign.Signature({ "alg": 'SHA256withECDSA' });
		try {
			sig.init({ d: skey, curve: 'secp256k1' });
			sig.updateString(msg);
			return sig.sign();
		}
		catch(err){
			console.error("Signing error: ", err);
			return null;
		}
	},
	ecdsa_sign_crypto : function(skey, msg){
		const sign = crypto.createSign('sha256');
		try {
			let pemPrivateKey = keyEncoder.encodePrivate(skey, 'raw', 'pem');
			sign.write(msg);
			sign.end();
			return sign.sign(pemPrivateKey, 'hex');
		}
		catch(err){
			console.error("Signing error: ", err);
			return null;
		}
	},
	check_valid_percent_params : function(param_obj){
		let len = Object.keys(param_obj).length;
		if(len < 1)
			return false;

		let sum = BigInt(0);
		for(let i = 0; i < len; i++){
			let value = Object.values(param_obj)[i];
			const parsed = parseInt(value, 10);
  			if (isNaN(parsed) || parsed < 0) 
  				return false; 
  			sum += BigInt(parsed);
		}
		return sum === this.PERCENT_FORMAT_SIZE;

	},
    genKeys : function(){
        const bob = crypto.createECDH('secp256k1');
        bob.generateKeys();
        return {
            prvkey : bob.getPrivateKey().toString('hex'),
            pubkey : bob.getPublicKey('hex', 'compressed')
        };
    },
	format_time(hrtime, points){
		return ((hrtime[0]*1e9 + hrtime[1])/1e9).toFixed(points || 6);
	},
	compareBlocksByHash(a, b) {
		if (a.hash < b.hash) return -1;
  		return a.hash > b.hash ? 1 : 0;		
	},
	hash_kblock : function(kblock, vm){
		if (!kblock)
			return undefined;

		let str = ['time','link','publisher','nonce','m_root'].map(v => crypto.createHash('sha256').update(kblock[v].toString().toLowerCase()).digest('hex')).join("");
		let blob = crypto.createHmac('sha256', '').update(str).digest().toString('hex');
		let hash = rx.hash(vm, blob);

		return Buffer.from(hash, "hex");
	},
	hash_mblock : function(block){
		let txs_hash = crypto.createHash('sha256').update(block.txs.map(tx => this.get_txhash(tx)).sort().join("")).digest('hex');
		return crypto.createHash('sha256').update(block.kblocks_hash.toLowerCase() + block.nonce.toString() + block.publisher.toLowerCase() + txs_hash.toLowerCase()).digest('hex');
	},
	hash_sblock : function(sblock){
		if (!sblock)
			return undefined;
		let str = ['bulletin','kblocks_hash','publisher','sign'].map(v => crypto.createHash('sha256').update(sblock[v].toString().toLowerCase()).digest('hex')).join("");
		return crypto.createHmac('sha256', '').update(str).digest();
	},
	hash_tx : function(tx){
		if (!tx)
			return undefined;
		let str = ['amount','from','nonce','sign','to'].map(v => crypto.createHash('sha256').update(tx[v].toString().toLowerCase()).digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	hash_snapshot : function(snapshot){
		let ledger_accounts_hash = crypto.createHash('sha256').update(snapshot.ledger.map(account => this.hash_ledger(account)).sort().join("")).digest('hex');
		let tokens_hash = crypto.createHash('sha256').update(snapshot.tokens.map(token => this.hash_token(token)).sort().join("")).digest('hex');
		let poses_hash = crypto.createHash('sha256').update(snapshot.poses.map(pos => this.hash_pos(pos)).sort().join("")).digest('hex');
		let delegates_hash = crypto.createHash('sha256').update(snapshot.delegates.map(delegate => this.hash_delegated(delegate)).sort().join("")).digest('hex');
		let undelegates_hash = crypto.createHash('sha256').update(snapshot.undelegates.map(undelegate => this.hash_undelegated(undelegate)).sort().join("")).digest('hex');
		return crypto.createHash('sha256').update(snapshot.kblocks_hash.toLowerCase() +
			ledger_accounts_hash.toLowerCase() +
			tokens_hash.toLowerCase() +
			poses_hash.toLowerCase() +
			delegates_hash.toLowerCase() +
			undelegates_hash.toLowerCase()).digest('hex');
	},
	hash_token : function(token){
		if (!token)
			return undefined;
		//TODO: fix token[v] != undefined (minable, reissuable fields have `null` value in DB)
		let str = ['hash','owner','fee_type','fee_value','fee_min','ticker','decimals','total_supply','caption','active', 'max_supply',
			'block_reward',
			'min_stake',
			'referrer_stake',
			'ref_share',
			'reissuable',
			'minable'].map(v => crypto.createHash('sha256').update(token[v] != undefined ? token[v].toString().toLowerCase() : '').digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	hash_pos : function(pos){
		if (!pos)
			return undefined;
		let str = ['id','owner','fee','name'].map(v => crypto.createHash('sha256').update(pos[v] != undefined ? pos[v].toString().toLowerCase() : '').digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	hash_ledger : function(account){
		if (!account)
			return undefined;
		let str = ['id','amount','token'].map(v => crypto.createHash('sha256').update(account[v].toString().toLowerCase()).digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	hash_delegated : function(delegate){
		if (!delegate)
			return undefined;
		let str = ['pos_id','delegator','amount','reward'].map(v => crypto.createHash('sha256').update(delegate[v].toString().toLowerCase()).digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	hash_undelegated : function(undelegate){
		if (!undelegate)
			return undefined;
		let str = ['id','pos_id','amount','height'].map(v => crypto.createHash('sha256').update(undelegate[v].toString().toLowerCase()).digest('hex')).join("");
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	merkle_root : function (mblocks, sblocks, snapshot_hash) {
		let acc = "";
		mblocks.sort(this.compareBlocksByHash);
		mblocks.forEach((mblock) => {
			acc = crypto.createHmac('sha256', '')
				.update(acc)
				.update(mblock.hash)
				.digest()
				.toString('hex');
		});
		if(sblocks)
			sblocks.sort(this.compareBlocksByHash);
			sblocks.forEach((sblock) => {
				acc = crypto.createHmac('sha256', '')
					.update(acc)
					.update(sblock.hash)
					.digest()
					.toString('hex');
			});
		if(snapshot_hash)
			acc = crypto.createHmac('sha256', '')
				.update(acc)
				.update(snapshot_hash)
				.digest()
				.toString('hex');
		return acc;
	},
	get_txhash : function(tx){
		if (!tx)
			return undefined;
		let model = ['amount','data','from','nonce','sign','ticker','to'];		
		let str;
		try{
			str = model.map(v => crypto.createHash('sha256').update(tx[v].toString().toLowerCase()).digest('hex')).join("");
		}
		catch(e){
			if (e instanceof TypeError) {
				console.info(tx);
				console.warn("Old tx format, skip new fields...");
				return undefined;
			}
		}
		return crypto.createHash('sha256').update(str).digest('hex');
    },
	// TODO: unnecessary function
	valid_sign_microblocks(mblocks){
		mblocks = mblocks.filter((mblock)=>{
			let signed_msg =  mblock.hash + (mblock.referrer ? (mblock.referrer) : "") + mblock.token;
			return this.ecdsa_verify(mblock.publisher, mblock.sign, signed_msg);
		});
		return mblocks;
	},
	valid_leader_sign(mblocks, LPoSID, ECC, cfg_ecc){
		mblocks = mblocks.sort(this.compareBlocksByHash);
		let ecc_mode = cfg_ecc.ecc_mode;
		let mblock_data = mblocks[0];
		let PK_LPoS = enq.getHash(mblock_data.kblocks_hash.toString() + LPoSID.toString() + mblock_data.nonce.toString());
		let isValid = false;
		try{
			if(ecc_mode === "short"){
				let MPK = enq.Point(enq.BigNumber(cfg_ecc[ecc_mode].MPK.x), enq.BigNumber(cfg_ecc[ecc_mode].MPK.y), ECC.curve);
				isValid = enq.verify(mblock_data.leader_sign, mblock_data.hash, PK_LPoS, ECC.G, ECC.G0, MPK, LPoSID, ECC.p, ECC.curve);
			}
			else{
				isValid = enq.verify_tate(mblock_data.leader_sign, mblock_data.hash, PK_LPoS, ECC.G0_fq, cfg_ecc[ecc_mode].MPK, LPoSID, ECC.curve, ECC.e_fq);
			}
		}
		catch(e){
			console.error(e);
		}
		return isValid;
	},
	valid_full_microblocks(mblocks, accounts, tokens, check_txs_sign){
		let total_tx_count = 0;
		mblocks = mblocks.filter((mblock)=>{
			let tok_idx = tokens.findIndex(t => t.hash === mblock.token);
			if(tok_idx < 0){
				console.trace(`ignoring mblock ${JSON.stringify(mblock)} : token not found`);
				return false;
			}
			if(tokens[tok_idx].minable !== 1){
				console.trace(`ignoring mblock ${JSON.stringify(mblock)} : token not minable`);
				return false;
			}
			let pub = accounts.findIndex(a => ((a.id === mblock.publisher) && ((a.token === mblock.token))));
			if (pub < 0){
				console.trace(`ignoring mblock ${JSON.stringify(mblock)} : publisher not found`);
				return false;
			}
			if ((accounts[pub].amount < tokens[tok_idx].min_stake)){
				console.trace(`ignoring mblock ${JSON.stringify(mblock)} due to low stake`);
				return false;
			}

			let recalc_hash = this.hash_mblock(mblock);
		 	let signed_msg = recalc_hash + (mblock.referrer ? (mblock.referrer) : "") + mblock.token;

		 	if(this.ecdsa_verify(mblock.publisher, mblock.sign, signed_msg)){
		 		console.trace(`mblock sign valid`);
		 		if (!check_txs_sign)
		 		    return true;
		 		total_tx_count += mblock.txs.length;
				mblock.txs = mblock.txs.filter((tx)=>{
					let hash = this.hash_tx_fields(tx);
					if(!this.ecdsa_verify(tx.from, tx.sign, hash)){
						console.warn(`Invalid sign (${tx.sign}) tx ${hash}`);
						return false;
					}else
						return true;
				});
				if(mblock.txs.length === 0){
					console.warn(`Ignore empty mblock ${mblock.hash}`);
					return false;
				}
				return true;
			} else{
				console.warn(`Invalid sign mblock ${mblock.hash}`);
				return false;
			}
		});
		console.trace(`total tx count = ${total_tx_count}`);
		return mblocks;
	},
	valid_full_statblocks(sblocks, pos_stakes, pos_min_stake, top_poses) {
		return sblocks.filter(s => {
			let pub = pos_stakes.findIndex(a => a.pos_id === s.publisher);
			if (pub > -1) {
				if(!top_poses.some(a => pos_stakes[pub].pos_id === a.pos_id)){
					console.trace(`ignoring sblock ${JSON.stringify(s)} contract is not in top poses`);
					return false;
				}
				if (pos_stakes[pub].self_del >= pos_min_stake) {
					return true;
				} else {
					console.trace(`ignoring sblock ${JSON.stringify(s)} due to low stake`);
					return false;
				}
			} else {
				console.trace(`ignoring sblock ${JSON.stringify(s)} contract not found`);
				return false;
			}
		});
	},
    exist_native_token_count(mblocks){
		return (mblocks.filter(m => m.token === this.ENQ_TOKEN_NAME)).length;
    },
	hash_tx_fields : function(tx){
		if (!tx)
			return undefined;
		let model = ['amount','data','from','nonce','ticker','to'];
		let str;
		try{
			str = model.map(v => crypto.createHash('sha256').update(tx[v].toString().toLowerCase()).digest('hex')).join("");
		}
		catch(e){
			if (e instanceof TypeError) {
				console.warn("Old tx format, skip new fields...");
				return undefined;
			}
		}
		return crypto.createHash('sha256').update(str).digest('hex');
	},
	slice_tx_data : function(datastr){
		if (typeof datastr === 'string')
			return datastr.match(/.{1,256}/g);
		else return null;
	},
	/**
	 * @return {number}
	 */
	PID : function(input, last_input, target_speed, ITerm){
		/*Compute all the working error variables*/
		let error = target_speed - input;
		let last_error = target_speed - last_input;
		//ITerm+= (ki * error);
		if( ITerm > this.outMax)  ITerm = this.outMax;
		else if( ITerm < this.outMin)  ITerm = this.outMin;

		let dInput = (error - last_error) ;// / timeChange;
		/*Compute PID Output*/
		let output = this.kp * error +  ITerm + this.kd * dInput;

		if(output > this.outMax) output = this.outMax;
		else if(output < this.outMin) output = this.outMin;

		return output;
	},
	difficulty_met : function(h, current_difficulty) {
	 	return this.difficulty(h) >= current_difficulty;
	},
	difficulty : function(h){
		let count = 0; //count of zeros bit at the beginning
		let i = 0;
		let bit = 0;
		do {
			bit = ((h[i/8|0]) & (1 << (7 - (i%8)))) >> (7 - (i%8));
			count += !(bit);
			i++;
		} while (!bit);

		let result = count;
		const diff_bits_count = 32;
		let shift = count % 8;
		shift++;

		for(let j = 0; j < 3 ;j++)
		{
			result = result <<8;
			let tmp = (h[ (i / 8 | 0) + j] << shift | h[(i / 8| 0) + 1 + j ] >>> (8 - shift)) & 255;
			result = result | tmp;
		}
		return result;
	},
	calc_difficulty : async function(db, target_speed, kblock) {
		let data_delta_time_1 = await db.get_time_delta_kblock(kblock.hash, this.MINER_CHECK_TARGET_INTERVAL);
		let data_delta_time_2 = await db.get_time_delta_kblock(kblock.link, this.MINER_CHECK_TARGET_INTERVAL);
		if (data_delta_time_1 === undefined || data_delta_time_2 === undefined) {
			console.trace("undefined time delta kblock");
			return 0;
		}
		let delta_time_1 = Number(data_delta_time_1['time']) / Number(this.MINER_CHECK_TARGET_INTERVAL);
		let delta_time_2 = Number(data_delta_time_2['time']) / Number(this.MINER_CHECK_TARGET_INTERVAL);

		let data = await db.get_avg_diff_kblock(kblock.hash, this.MINER_CHECK_TARGET_INTERVAL);
		let avg_diff_1 = Number(data['avg_diff']);
		let iterm_res = await db.get_iterm(kblock.hash, this.ki, this.MINER_CHECK_TARGET_INTERVAL);
		let diff_offset = this.PID(delta_time_1, delta_time_2, target_speed,  Number(iterm_res['iterm']));
		let difficulty = avg_diff_1 + diff_offset;

		console.trace(`Recalc target difficulty = ${(this.understandable_difficulty(difficulty)).toFixed(2)}`);
		if (difficulty < 0) {
			console.warn(`Incorrect calc difficulty. Difficulty value: ${difficulty}, delta_time: ${delta_time_1}, avg_diff: ${avg_diff_1}, diff_offset: ${diff_offset}`);
			difficulty = 0;
		}
		return difficulty;
	},
	calc_fee(tokendata, amount){
		amount = BigInt(amount);
		if(tokendata.fee_type === 0)
			return BigInt(tokendata.fee_value);
		if(tokendata.fee_type === 1){
			if(amount <= tokendata.fee_min)
				return BigInt(tokendata.fee_min);
			let fee =  amount / (this.PERCENT_FORMAT_SIZE + BigInt(tokendata.fee_value)) * BigInt(tokendata.fee_value);
			//fee = Number(fee);
			if(fee < tokendata.fee_min)
				return BigInt(tokendata.fee_min);
			return fee;
		}
	},
	understandable_difficulty : function(int32){
		let ceil = (int32 >> 24);
		let div = int32 - (ceil<<24);
		return  ceil + (div / 16777215);
	},
	blocks_equal : function(v1, v2, vm){
		return Buffer.compare(this.hash_kblock(v1, vm), this.hash_kblock(v2, vm)) === 0;
	},
	coincidence : function (a, b, vm) {
		if ((a.constructor !== Array) || (b.constructor !== Array))
			console.warn('Parameter is not array');
		for (let i = 0; i < a.length; i++){
			for (let j = 0; j < b.length; j++){
				if (this.blocks_equal(a[i], b[j], vm) === true){
					return true;
				}
			}
		}
		return false;
	},
	ecc_get_session_keyshare : function(PK_LPoS, keypart, curveFp, curveFpm){
		PK_LPoS = enq.BigNumber(PK_LPoS);
		let Q = enq.getQ(PK_LPoS, curveFp, curveFpm);
		let ss = enq.mul(keypart, Q, curveFp);
		return ss;
	},
	ecc_key_recovery : function(proj, coalition, q1, PK_LPoS, curveFp, curveFpm){
		PK_LPoS = enq.BigNumber(PK_LPoS);
		let Q = enq.getQ(PK_LPoS, curveFp, curveFpm);
		let secret = enq.keyRecovery(proj, coalition, q1, curveFp);
		return secret;
	},
    http : {
        get : function(url, data){
            let options = {
                method:  'GET',
                url: url,
                qs : data
            };
            return apiRequest(options)
        },
        post : function(url, data){
            let options = {
                method:  'POST',
                url: url,
                body: data,
                json: true
            };
            return apiRequest(options)
        }
    },
	sleep : function(ms){
		return new Promise(function(resolve, reject){
			setTimeout(() => resolve(), ms)
		});
	},
	JSON_stringify : function(data){
		return JSON.stringify(data, (key, value) =>
						            typeof value === 'bigint'
						                ? value.toString()
						                : value // return everything else unchanged
		);
	},
	load_snapshot_from_file(path){
		let snapshot = undefined;
		try {
			snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
		} catch (e) {
			console.info('No snapshot file found.', e);
		}
		return snapshot;
	},
	strToFloat : function(input, decimals=10, fixed=10) {
		if(typeof input === 'string') {
			let str = BigInt(input).toString();
			let integerPart = '0';
			let fractionalPart = '0';
			let delimiter = decimals !== 0 ? (fixed !== 0 ? '.' : '') : '';
			if (str.length > decimals) {
				integerPart = BigInt(str.substring(0, str.length - decimals)).toString();
				fractionalPart = str.substring(str.length - decimals);
			} else {
				fractionalPart = str.substring(str.length - decimals);
				for (let i = 0; i < (decimals - str.length); i++) {
					fractionalPart = '0' + fractionalPart;
				}
			}
			return integerPart + delimiter + fractionalPart.substring(0, fixed);
		}
		else return '';
	}
};



module.exports = utils;
module.exports.ECC = ECC;
