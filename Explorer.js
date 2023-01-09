/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Explorer.js
 * Blockchain explorer instance
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const express = require('express');
const cors = require('cors');
const {ContractError} = require('./errors');
const {ExplorerService, ExplorerServicePlain} = require('./explorer.service');
const NodeapiService = require('./nodeapi.service').NodeapiService;
const Utils = require('./Utils');
const Transport = require('./Transport').Tip;
const ContractMachine = require('./SmartContracts');
//const swaggerJSDoc = require('swagger-jsdoc');
let swaggerSpec;

class Explorer {

	constructor(port, db, pending, stake_limits, config) {
		this.app = express();
		this.app.use(cors());
		this.db = db;
		this.config = config;
		this.pending = pending;
		this.stake_limits = stake_limits;
		this.service = new ExplorerService(db);
		this.servicePlain = new ExplorerServicePlain(db);
		this.serviceNodeapi = new NodeapiService(db);
		this.transport = new Transport(config.id, 'explorer');
		
		this.app.listen(port, function(){
			console.info('Explorer started at ::', port);

		const options = {
		  definition: {
		    openapi: '3.0.0', // Specification (optional, defaults to swagger: '2.0')
		    info: {
		      title: 'Enecuum Node API', // Title (required)
		      version: '1.0.0', // Version (required)
		      description: `|
    Enecuum is a cryptocurrency project designed to involve both mobile and desktop devices into one blockchain network. Enecuum provides a payment platform with the use of a native token. Enecuum's native token, ENQ, can be bought on the exchange, by card, or mined on PCs and smartphones. 

    Below, you can read a short explanation of the basic terms and concepts related to Enecuum and cryptocurrency in general. The description will help you better understand the Enecuum API.
    
    When a user creates an account in the Enecuum network, a pair of public and private keys is generated. 

    **The public key** is a user's identification. It is used as a wallet address. The user can safely share the public key to receive payments.

    **The private key** acts as a password. It is used to access the account. The user must never share the private key. The private key needs to be backed up. If a private key is lost, the account will never be recovered.

    Enecuum has a native token, ENQ, which is used for payments in the Enecuum network. Enecuum also allows the issue of custom tokens. Each token has two unique identifiers: ticker and hash. A **ticker** is a 1-6 letter name used for convenience. A **hash** is a 64-character sequence that acts as a technical identification. 

    Each token token has a fixed number of **decimal places**. When using Enecuum API, the methods will return the token amount as an integer. Because of this, the returned amount is multiplied by 10^*d*, where *d* stands for the number of decimal places. For example, ENQ has 10 decimal places. The returned amount 250050000000 correlates with 25.005 ENQ.
    `
		    },
		    servers:{
				url: 'https://bit.enecuum.com/api/v1'
		    },
		  },
		  // Path to the API docs
		  apis: ['./Explorer.js'],
		};

		// Initialize swagger-jsdoc -> returns validated swagger spec in json format
		//swaggerSpec = swaggerJSDoc(options);
		//console.log(swaggerSpec);
		});

		this.app.use(express.json());

		this.app.get('/api/v1/network_info', async (req, res) => {
			console.trace('requested network_info', req.query);
			let native_token = (await this.db.get_tokens_info([this.config.native_token_hash]))[0];
			let data = {
				target_speed: this.config.target_speed,
				reward_ratio: this.config.reward_ratio,
				transfer_lock: this.config.transfer_lock,
				pos_min_stake: this.config.pos_min_stake,
				native_token: native_token,
				snapshot_interval: this.config.snapshot_intervcal,
				origin: this.config.ORIGIN,
				fee_shares : this.config.fee_shares,
				MPK : this.config.ecc[this.config.ecc.ecc_mode].MPK,
				mblock_slots: {
					size:this.config.mblock_slots.size,
					count:this.config.mblock_slots.count,
					min_stake:this.config.mblock_slots.min_stake
				},
				dex : this.config.dex
			};
			res.send(data);
		});

		this.app.get('/api/v1/native_token', async (req, res) => {
			console.trace('requested native_token', req.query);
			let data = (await this.db.get_tokens_info([this.config.native_token_hash]))[0];
			res.send(data);
		});

		this.app.get('/api/v1/page', async (req, res) => {
			console.trace('requested page', req.query);		
			let data = await this.db.get_page(req.query.n, 10);
			res.send(data);
		});

		this.app.get('/api/v1/macroblock', async (req, res) => {
			console.trace('requested macroblock', req.query);
			let data = await this.db.get_macroblock_header(req.query.hash);
			res.send(data);
		});

		this.app.get('/api/v1/macroblock_by_height', async (req, res) => {
			console.trace('requested macroblock by height(', req.query);
			let data = await this.db.get_macroblock_header_by_height(req.query.height);
			res.send(data);
		});

		this.app.get('/api/v1/mblock', async (req, res) => {
			console.trace('requested mblock', req.query);
			let data = await this.db.get_mblock_data(req.query.hash);
			res.send(data);
		});

		this.app.get('/api/v1/sblock', async (req, res) => {
			console.trace('requested sblock', req.query);
			let data = await this.db.get_sblock_data(req.query.hash);
			res.send(data);
		});

		this.app.get('/api/v1/lastblocks', async (req, res) => {
			console.trace('requested lastblocks', req.query);
			let blocks = await this.db.get_lastblocks(10);
			res.send({blocks});
		});

		this.app.get('/api/v1/lasttxs', async (req, res) => {
			console.trace('requested lasttxs', req.query);
			let data = await this.db.get_lasttxs(10);
			res.send(data);
		});

		this.app.get('/api/v1/tps', async (req, res) => {
			console.trace('requested tps', req.query);
			let data = await this.db.get_tps(300);
			await this.db.update_max_tps(data.tps);
			res.send(data);
		});

		this.app.get('/api/v1/account', async (req, res) => {
			BigInt.prototype.toJSON = function() { return this.toString() }
			console.trace('requested account', req.query);
			let data = await this.db.get_account_all(req.query.id, req.query.page, 10);
			if(data.records !== undefined)
				for(let i = 0; i< data.records.length; i++){
					if(data.records[i].fee_type !== null) {
						let tokendata = {
							fee_type: data.records[i].fee_type,
							fee_value: data.records[i].fee_value,
							fee_min: data.records[i].fee_min
						};
						if (data.records[i].input !== null) {
							let fee = Utils.calc_fee(tokendata, data.records[i].input);
							data.records[i].input = BigInt(data.records[i].input) - fee;
							data.records[i].fee = fee;
						} else if (data.records[i].output !== null) {
							let fee = Utils.calc_fee(tokendata, data.records[i].output);
							data.records[i].output = BigInt(data.records[i].output) - fee;
							data.records[i].fee = fee;
						}
					}
				}
			res.send(data);
		});

		this.app.get('/api/v1/account_in', async (req, res) => {
			console.trace('requested account_in', req.query);
			let data = await this.db.get_account_in(req.query.id, req.query.page, 10);
			if(data.records != undefined)
				for(let i = 0; i< data.records.length; i++){
					if(data.records[i].fee_type !== null) {
						let tokendata = {
							fee_type: data.records[i].fee_type,
							fee_value: data.records[i].fee_value,
							fee_min: data.records[i].fee_min
						};
						let fee = Utils.calc_fee(tokendata, data.records[i].input);
						data.records[i].input = BigInt(data.records[i].input) - fee;
						data.records[i].fee = fee;
					}
				}
			res.send(data);
		});

		this.app.get('/api/v1/account_out', async (req, res) => {
			console.trace('requested account_out', req.query);
			let data = await this.db.get_account_out(req.query.id, req.query.page, 10);
			if(data.records != undefined)
				for(let i = 0; i< data.records.length; i++){
					if(data.records[i].fee_type !== null) {
						let tokendata = {
							fee_type: data.records[i].fee_type,
							fee_value: data.records[i].fee_value,
							fee_min: data.records[i].fee_min
						};
						let fee = Utils.calc_fee(tokendata, data.records[i].output);
						data.records[i].output = BigInt(data.records[i].output) - fee;
						data.records[i].fee = fee;
					}
				}
			res.send(data);
		});

		this.app.get('/api/v1/account_transactions', async (req, res) => {
			console.trace('requested account_transactions', req.query);
			let data = await this.db.get_account_transactions(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/account_rewards', async (req, res) => {
			console.trace('requested account_mreward', req.query);
			let data = await this.db.get_account_rewards(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/account_mreward', async (req, res) => {
			console.trace('requested account_mreward', req.query);
			let data = await this.db.get_account_mreward(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/account_sreward', async (req, res) => {
			console.trace('requested account_sreward', req.query);
			let data = await this.db.get_account_sreward(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/account_refreward', async (req, res) => {
			console.trace('requested account_refreward', req.query);
			let data = await this.db.get_account_refreward(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/account_kreward', async (req, res) => {
			console.trace('requested account_kreward', req.query);
			let data = await this.db.get_account_kreward(req.query.id, req.query.page, 10);
			res.send(data);
		});

		this.app.get('/api/v1/eindex_by_hash', async (req, res) => {
			console.trace('requested eindex_by_hash', req.query);
			let data = await this.db.get_eindex_by_hash(req.query.hash);
			res.send(data);
		});

        this.app.get('/api/v1/top_accounts', async (req, res) => {
            let data = await this.db.get_top_accounts(req.query.page, 20, req.query.token_hash);
            for(let i = 0; i < data.accounts.length; i++){
                data.accounts[i].percentage = data.accounts[i].amount * (100) / data.total;
			}
            res.send({accounts : data.accounts, page_count : data.page_count});
        });

        this.app.get('/api/v1/get_token_info_page', async (req, res) => {
            let data = await this.db.get_token_info_page(parseInt(req.query.page), 20, req.query.type);
            if(data.tokens) {
				data.tokens.forEach(t => {
					t.price_raw = {
						cg_price: t.cg_price,
						dex_price: t.dex_price,
						decimals: t.price_decimals
					};
					delete t.cg_price;
					delete t.dex_price;
					delete t.price_decimals
				});
			}
            res.send({tokens : data.tokens, page_size : 20, page_count : data.page_count});
        });

        this.app.get('/api/v1/get_tokens_by_owner', async (req, res) => {
			console.trace('requested get_tokens_by_owner', req.query);
			let owner = req.query.owner;
			let data = await this.db.get_tokens_by_owner(owner);
			console.trace(`get_tokens_by_owner = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/balance', async (req, res) => {
			console.trace('requested balance', req.query);
			let id = req.query.id;
			let token = req.query.token || Utils.ENQ_TOKEN_NAME;
			let data = await this.db.get_balance(id, token);
			console.trace(`balance = `, JSON.stringify(data));
			let delegated_data = (await this.db.get_delegated_balance(id));
			data.delegated = delegated_data.delegated;
			data.reward = delegated_data.reward;
			console.trace(`reward  = `, JSON.stringify(delegated_data.reward));
			console.trace(`delegated = `, JSON.stringify(delegated_data.delegated));
			let transit = (await this.db.get_transit_balance(id));
			data.transit = transit;
			console.trace(`transit = `, JSON.stringify(transit));
			let undelegated = (await this.db.get_undelegated_balance(id));
			data.undelegated = undelegated;
			console.trace(`undelegated = `, JSON.stringify(undelegated));
			res.send(data);
		});

		this.app.get('/api/v1/balance_all', async (req, res) => {
			console.trace('requested balances', req.query);
			let id = req.query.id;
			let data = await this.db.get_balance_all(id);
			let that = this;
			data = data.filter(item => that.config.tokens_white_list.includes(item.token));
			console.trace(`balances = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/balance_all_unfiltered', async (req, res) => {
			console.trace('requested balance all unfiltered', req.query);
			let id = req.query.id;
			let data = await this.db.get_balance_all(id);
			console.trace(`balances = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/balance_mineable', async (req, res) => {
			console.trace('requested balance mineable', req.query);
			let id = req.query.id;
			let data = await this.db.get_balance_mineable(id);
			console.trace(`balances = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/balance_reissuable', async (req, res) => {
			console.trace('requested balance reissuable', req.query);
			let id = req.query.id;
			let data = await this.db.get_balance_reissuable(id);
			console.trace(`balances = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/token_info', async (req, res) => {
			console.trace('requested token_info', req.query);
			let hash = req.query.hash;
			let data = await this.db.get_tokens_info([hash]);
			console.trace(`token_info = `, JSON.stringify(data));
			res.send(data);
		});

		this.app.get('/api/v1/tx', async (req, res) => {
			console.trace(`requested tx ${JSON.stringify(req.query)}`);
			let tx = (await this.db.get_tx(req.query.hash))[0];
			if(tx !== undefined && tx.fee_type !== null) {
				let tokendata = { fee_type: tx.fee_type, fee_value: tx.fee_value, fee_min: tx.fee_min};
				tx.fee = (Utils.calc_fee(tokendata, tx.total_amount));
				tx.amount = (BigInt(tx.total_amount) - tx.fee).toString();
				tx.fee = tx.fee.toString();
			}
			res.send(tx);
		});

		this.app.get('/api/v1/success_tx_by_height', async (req, res) => {
			console.trace(`requested success_tx_by_height ${JSON.stringify(req.query)}`);
			let txs = await this.db.get_successful_txs_by_height(req.query.height);
			res.send(txs);
		});

		this.app.get('/api/v1/peer_map', async (req, res) => {
			console.trace('requested poa', req.query);
			let poa = await this.db.get_clients();
			res.send(poa);
		});

		this.app.get('/api/v1/poa_nodes_online', async (req, res) => {
			console.trace('requested poa_nodes_online', req.query);
			let poa = await this.db.get_clients_list();
			res.send(poa);
		});

		this.app.get('/api/v1/search', async (req, res) => {
			console.trace('requested search', req.query);			
			let resp = [];

			let tx = await this.db.get_tx(req.query.value);
			if (tx.length > 0) {
				resp.push({type:'tx', info:tx});
			} else {
				let account = await this.db.get_accounts_all(req.query.value);
				if (account.length > 0){
					resp.push({type:'account', info:{balances: account}});
				}

				let kblock = await this.db.get_kblock(req.query.value);
				if (kblock.length > 0) {
					resp.push({type:'kblock', info:kblock});
				}

				let mblock = await this.db.get_mblock(req.query.value);
				if (mblock.length > 0) {
					resp.push({type:'mblock', info:mblock});
				}

				let sblock = await this.db.get_sblock_data(req.query.value);
				if (sblock.header !== undefined) {
					resp.push({type:'sblock', info:sblock});
				}
			}

			let token = await this.db.get_tokens_info([req.query.value]);
		 	if (token.length > 0 && token[0].hash !== undefined) {
		 		resp.push({type:'token', info:token});

			 	let pool = await this.db.dex_get_pools_all();
			 	if (pool.length > 0 && pool[0].pair_id !== undefined) {
			 		pool.forEach(item => {
			 			if (item.token_hash === req.query.value)
			 				resp.push({type:'pool', info:item});
			 		})			 		
			 	}
		 	} else {
				let pool = await this.db.dex_get_pools([req.query.value]);
				if (pool.length > 0) {
					resp.push({type:'pool', info:pool});
				}		 		
		 	}

		 	let pos = await this.db.get_pos_contract_info(req.query.value);
		 	if (pos.length > 0 && pos[0].pos_id !== undefined) {
		 		resp.push({type:'pos', info:pos});
		 	}

		 	let farm = await this.db.get_dex_farms('',[req.query.value]);
		 	if (farm.length > 0 && farm[0].farm_id !== undefined) {
		 		resp.push({type:'farm', info:farm});
		 	}

			res.send(resp);
		});

		this.app.get('/api/v1/stats', async (req, res) => {
			console.trace('requested stats', req.query);
			let stats = await this.db.get_stat();
			let result = {};
			for(let stat of stats){
				if(['cg_btc', 'cg_eth', 'cg_usd', 'difficulty'].includes(stat.key) === false)
					stat.value = parseInt(stat.value);
				result[stat.key] = stat.value;
			}
			console.trace(`stats = ${JSON.stringify(stats)}`);
			res.send(result);
		});

		this.app.post('/api/v1/tx', async (req, res, next) => {
			let txs = req.body;
			console.trace(`post txs`, JSON.stringify(txs));

			if (txs.length !== 1)
				return res.send({err: 1, message: "Only 1 TX can be sent"});

			try{
				if (txs.length !== 1)
					return res.send({err: 1, message: "Only 1 TX can be sent"});
				let result = await this.serviceNodeapi.post_tx(txs[0]);
				if(result.err === 0)
					this.transport.broadcast("post_tx", txs[0]);
				return res.send(result);
			}
			catch(err){
				next(err);
			}
		});

		this.app.get('/api/v1/ver', async (req, res) => {
			console.trace(`get ver`, JSON.stringify(req.body));
			let ver = await this.db.get_ver();
			res.send(ver);
		});

		this.app.get('/api/v1/get_min_stake', async (req, res) => {
			console.trace(`get min_stake`, JSON.stringify(req.body));
			res.send({min_stake:parseFloat(this.stake_limits.min_stake)});
		});

		this.app.get('/api/v1/get_stake_limits', async (req, res) => {
			console.trace(`get stake_limits`, JSON.stringify(req.body));
			res.send(this.stake_limits);
		});

		this.app.get('/api/v1/referrer_stake', async (req, res) => {
			console.trace(`get referrer_stake`, JSON.stringify(req.body));
			let referrer_stake = await this.db.get_referrer_stake();
			res.send({referrer_stake:parseFloat(referrer_stake.referrer_stake)});
		});

		this.app.get('/api/v1/roi', async (req, res) => {
			console.trace(`get roi`, JSON.stringify(req.query));
			let options = {
				hash : req.query.hash || Utils.ENQ_TOKEN_NAME
			};
			let roi = await this.db.get_roi(options.hash);
			res.send(roi);
		});

		this.app.get('/api/v1/mblocks', async (req, res) => {
			console.trace('requested mblocks', req.query);
			let offset = parseInt(req.query.offset) || 0;
			let limit = parseInt(req.query.limit) || 0;
			if(limit > 10)
				limit = 10;
			let data = await this.db.get_mblocks_info(offset, offset + limit - 1);
			res.send(data);
		});
		this.app.get('/api/v1/height', async (req, res) => {
			console.trace('requested height');
			let data = await this.db.get_mblocks_height();
			let result = {};
			if(data.height){
				result.height = parseInt(data.height);
			}
			res.send(result);
		});
		// TODO: can be replaced with stat field
		this.app.get('/api/v1/poa_with_stake', async (req, res) => {
			console.trace(`get total poa with stake`, JSON.stringify(req.query));
			let count = await this.db.get_staking_poa_count();
			res.send(count);
		});

		this.app.get('/api/v1/roi_by_stake', async (req, res) => {
			console.trace(`get roi_by_stake`, JSON.stringify(req.query));
			let options = {
				hash : req.query.hash || Utils.ENQ_TOKEN_NAME,
				stake : parseInt(req.query.stake || 0)
			};
			if(!req.query.hasOwnProperty('stake'))
				return res.send({error: 1, msg : 'Stake not specified'});

			let rois = await this.db.get_roi(options.hash);
			let stake = options.stake;
			if(stake < rois[0].stake || stake > rois[rois.length-1].stake)
				return res.send({error: 1, msg : 'Stake value is out of range'});
			let roi = stake;
			for (let i = 0; i < rois.length; i++) {
				if(stake === rois[i].stake){
					roi = rois[i].roi;
					break;
				}
				else if(stake < rois[i].stake){
					roi = (rois[i-1].roi + ((stake - rois[i-1].stake) / (rois[i].stake - rois[i-1].stake)) * (rois[i].roi - rois[i-1].roi))
					break;
				}
			}
			let ratio = ((roi - stake) / stake);
			res.send({
				hash : options.hash,
				percent: [ratio*100, ratio*100*7, ratio*100*30, ratio*100*365],
				enq: [ratio*stake, ratio*stake*7, ratio*stake*30, ratio*stake*365]
			});
		});

		this.app.get('/api/v1/stat/agent_info', async (req, res) => {
			console.trace(`agent_info`, JSON.stringify(req.query));
			let info = await this.db.get_agent_info(req.query.id);
			res.json(info);
		});

		this.app.get('/api/v1/pending_size', async (req, res) => {
			console.trace('pending_size', req.query);
			let data = await this.db.get_pending_size();
			res.send(data);
		});

		this.app.get('/api/v1/pending_tx_hash', async (req, res) => {
			console.trace('pending_tx_hash', req.query);
			let data = await this.db.get_pending_by_hash(req.query.hash);
			res.send(data);
		});

		this.app.get('/api/v1/pending_tx_account', async (req, res) => {
			console.trace('pending_tx_account', req.query);
			let options = {
				id : req.query.id,
				filter : req.query.filter
			};
			let data = await this.db.get_pending_by_id(options);
			res.send(data);
		});

		this.app.get('/api/v1/contract_pricelist', async (req, res) => {
			console.trace('contract_pricelist');
			let n = (await this.db.get_mblocks_height()).height;
			let CMachine = ContractMachine.getContractMachine(this.config.FORKS, n);
			let cont = new CMachine.Contract();
			res.send(cont.pricelist);
		});

		this.app.get('/api/v1/difficulty', async (req, res) => {
			console.trace('difficulty', req.query);
			let data = await this.db.get_difficulty(100);
			res.send(data);
		});

		this.app.get('/api/v1/get_top_pos', async (req, res) => {
			console.trace('get_top_pos', req.query);
			let top_pos = await this.db.get_top_pos();
			let r = await this.db.get_total_pos_stake();
			console.info(r.total_daily_pos_stake);
			for(let i = 0; i < top_pos.length; i++){
				top_pos[i].percent = top_pos[i].stake/r.total_daily_pos_stake * 100;
			}	
			res.send({top_pos});
		});

		this.app.get('/api/v1/get_tokens_count', async (req, res) => {
			console.trace('get_tokens_count', req.query);
			let count = await this.db.get_tokens_count();
			res.send(count);
		});

		this.app.get('/api/v1/get_token_holder_count', async (req, res) => {
			console.trace('get token holder count', req.query);
			let count = await this.db.get_accounts_count(req.query.token_hash);
			res.send(count);
		});

		/**
		* @swagger
		* /get_tickers_all:
		*   get:
		*     description: Returns tickers
		*     tags:
		*      - Tickers
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: tickers
		*/
		this.app.get('/api/v1/get_tickers_all', async (req, res) => {
			console.trace('get_tickers_all', req.query);
			let ticker_all = await this.db.get_tickers_all();
			let that = this;
			ticker_all.filter(item => that.config.tokens_white_list.includes(item.hash));
			res.send(ticker_all);
		});

		this.app.get('/api/v1/get_tickers_all_unfiltered', async (req, res) => {
			console.trace('get_tickers_all_unfiltered', req.query);
			let ticker_all = await this.db.get_tickers_all();
			res.send(ticker_all);
		});

		/**
		* @swagger
		* /get_pos_total_stake:
		*   get:
		*     description: Return total stake
		*     tags:
		*      - Tickers
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: total_stake
		*/
		this.app.get('/api/v1/get_pos_total_stake', async (req, res) => {
			console.trace('get_pos_total_stake', req.query);
			let total_stake = await this.db.get_pos_total_stake();
			res.send(total_stake);
		});

		this.app.get('/api/v1/get_pos_active_total_stake', async (req, res) => {
			console.trace('get_pos_active_total_stake', req.query);
			let total_stake = await this.db.get_pos_active_total_stake();
			res.send(total_stake);
		});

		/**
		* @swagger
		* /get_pos_list_count:
		*   get:
		*     description: Return pos count
		*     tags:
		*      - Pos
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: pos_count
		*/
		this.app.get('/api/v1/get_pos_list_count', async (req, res) => {
			console.trace('get_pos_list_count', req.query);
			let cnt = await this.db.get_pos_contract_count();
			res.send(cnt);
		});

		/**
		* @swagger
		* /get_pos_list_all:
		*   get:
		*     description: Return pos list all
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: page_num		
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{pos_id, pos_owner, fee, pos_stake}. …]
		*/
		this.app.get('/api/v1/get_pos_list_page', async (req, res) => {
			console.trace('get_pos_list_page', req.query);
			let data = await this.db.get_pos_contract_info_page(req.query.page, 20);
            res.send(data);
		});

		this.app.get('/api/v1/get_pos_info', async (req, res) => {
			console.trace('get_pos_info', req.query);
			let data = await this.db.get_pos_contract_info(req.query.pos_id);
            res.send(data);
		});

		this.app.get('/api/v1/get_pos_list_all', async (req, res) => {
			console.trace('get_pos_list_all', req.query);
			let data = await this.db.get_pos_contract_info_all();
            res.send(data);
		});


		/**
		* @swagger
		* /get_pos_list:
		*   get:
		*     description: Return pos list
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: owner 		
		*	   description: owner addres (public key).	
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{pos_id, pos_owner, fee, pos_stake}, ...]
		*/
		this.app.get('/api/v1/get_pos_list', async (req, res) => {
			console.trace('get_pos_list', req.query);
			let data = await this.db.get_pos_contract_list(req.query.owner);
            res.send(data);
		});

		/**
		* @swagger
		* /get_delegated_list:
		*   get:
		*     description: Return delegated list
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: delegator  		
		*	   description: delegator addres (public key).	
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{pos_id, amount}, …]
		*/
		this.app.get('/api/v1/get_delegated_list', async (req, res) => {
			console.trace('get_delegated_list', req.query);
			let data = await this.db.get_pos_delegated_list(req.query.delegator);
            res.send(data);
		});

		/**
		* @swagger
		* /get_delegated_page:
		*   get:
		*     description: Return delegated page
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: delegator  		
		*	   description: delegator addres (public key).	
		*		- name: page
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: {pos_degated: [{pos_id, amount}, …], page_count}
		*/
		this.app.get('/api/v1/get_delegated_page', async (req, res) => {
			console.trace('get_delegated_page', req.query);
			let data = await this.db.get_pos_delegated_page(req.query.delegator, req.query.page, 20);
            res.send(data);
		});

		/**
		* @swagger
		* /get_undelegated_list:
		*   get:
		*     description: Return undelegated list
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: delegator  		
		*	   description: delegator addres (public key).	
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{tx_hash, pos_id, amount, height, timestamp}, …]
		*/
		this.app.get('/api/v1/get_undelegated_list', async (req, res) => {
			console.trace('get_undelegated_list', req.query);
			let data = await this.db.get_pos_undelegated_list(req.query.delegator);
			res.send(data);
		});


		/**
		* @swagger
		* /get_undelegated_page:
		*   get:
		*     description: Return undelegated page
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: delegator  		
		*	   description: delegator addres (public key).	
		*		- name: page
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: {pos_undegated: [{pos_id, amount}, …], page_count}
		*/
		this.app.get('/api/v1/get_undelegated_page', async (req, res) => {
			console.trace('get_undelegated_page', req.query);
			let data = await this.db.get_pos_undelegated_page(req.query.delegator, req.query.page, 20);
            res.send(data);
		});

		/**
		* @swagger
		* /get_delegators_list:
		*   get:
		*     description: Return delegators list
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: pos_id  		
		*	   description: pos_id  (hash created tx).	
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{delegator, amount}, …]
		*/
		this.app.get('/api/v1/get_delegators_list', async (req, res) => {
			console.trace('get_delegators_list', req.query);
			let data = await this.db.get_pos_delegators(req.query.pos_id);
			res.send(data);
		});

		/**
		* @swagger
		* /get_delegators_page:
		*   get:
		*     description: Return delegators page
		*     tags:
		*      - Pos
		*	  parameters:
		*	   - name: pos_id  		
		*	   description: pos_id  (hash created tx).	
		*      - name: page
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: {delegators:[{delegator, amount}, …], page_count}
		*/
		this.app.get('/api/v1/get_delegators_page', async (req, res) => {
			console.trace('get_delegators_page', req.query);
			let data = await this.db.get_pos_delegators_page(req.query.pos_id, req.query.page, 20);
			res.send(data);
		});

		/**
		* @swagger
		* /get_transfer_lock:
		*   get:
		*     description: Return transfer lock
		*     tags:
		*      - Pos		
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: {transfer_lock}
		*/
		this.app.get('/api/v1/get_transfer_lock', async (req, res) => {
			console.trace('get_transfer_lock', req.query);
			let transfer_lock = this.db.app_config.transfer_lock;
			res.send({transfer_lock});
		});

		/**
		* @swagger
		* /get_pos_names:
		*   get:
		*     description: Return pos name list
		*     tags:
		*      - Pos		
		*     produces:
		*      - application/json
		*     responses:
		*       200:
		*         description: [{pos_id, pos_name},…]
		*/
		this.app.get('/api/v1/get_pos_names', async (req, res) => {
			console.trace('get_pos_names', req.query);
			let data = await this.db.get_pos_names();
            res.send(data);
		});

		this.app.get('/api/v1/get_dex_pools', async (req, res) => {
			console.trace('get_dex_pools', req.query);
			let data = await this.db.dex_get_pools_all();
			for (let rec of data) {
				let tokens_info = await this.db.get_tokens_info([rec.asset_1, rec.asset_2]);
				let price_token_1 = ((tokens_info.find(t => t.hash === rec.asset_1)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.asset_1)).cg_price_usd : (tokens_info.find(t => t.hash === rec.asset_1)).dex_price_usd;
				let price_token_2 = ((tokens_info.find(t => t.hash === rec.asset_2)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.asset_2)).cg_price_usd : (tokens_info.find(t => t.hash === rec.asset_2)).dex_price_usd;
				if( price_token_1 && price_token_2 ){
					rec.liquidity = rec.volume_1 / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_1).decimals) * price_token_1 +
									rec.volume_2 / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_2).decimals) * price_token_2;
				} else if (price_token_1) {
					rec.liquidity = rec.volume_1 / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_1).decimals) * price_token_1 * 2;
				} else if (price_token_2) {
					rec.liquidity = rec.volume_2 / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_2).decimals) * price_token_2 * 2;
				} else
					rec.liquidity = null;
			}
			res.send(data);
		});

		this.app.get('/api/v1/get_sstation_pools', async (req, res) => {
			console.trace('get_sstation_pools', req.query);
			let data = await this.db.dex_get_sstation_pools();
			for (let rec of data) {
				let tokens_info = await this.db.get_tokens_info([rec.asset_LP, rec.asset_ENX]);
				let LP_price_token = ((tokens_info.find(t => t.hash === rec.asset_LP)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.asset_LP)).cg_price_usd : (tokens_info.find(t => t.hash === rec.asset_LP)).dex_price_usd;
				let ENX_price_token = ((tokens_info.find(t => t.hash === rec.asset_ENX)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.asset_ENX)).cg_price_usd : (tokens_info.find(t => t.hash === rec.asset_ENX)).dex_price_usd;
				rec.decimals_LP = tokens_info.find(t => t.hash === rec.asset_LP).decimals;
				rec.ticker_LP = tokens_info.find(t => t.hash === rec.asset_LP).ticker;
				rec.decimals_ENX = tokens_info.find(t => t.hash === rec.asset_ENX).decimals;
				rec.ticker_ENX = tokens_info.find(t => t.hash === rec.asset_ENX).ticker;
				if( LP_price_token && ENX_price_token ){
					rec.liquidity = rec.volume_LP / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_LP).decimals) * LP_price_token +
						rec.volume_ENX / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_ENX).decimals) * ENX_price_token;
				} else if (LP_price_token) {
					rec.liquidity = rec.volume_LP / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_LP).decimals) * LP_price_token * 2;
				} else if (ENX_price_token) {
					rec.liquidity = rec.volume_ENX / Math.pow(10, tokens_info.find(t => t.hash === rec.asset_ENX).decimals) * ENX_price_token * 2;
				} else
					rec.liquidity = null;
			}
			res.send(data);
		});

		this.app.get('/api/v1/get_farms', async (req, res) => {
			console.trace('get_farms', req.query);
			let data = await this.db.get_farms_all();
			res.send(data);
		});

		this.app.get('/api/v1/get_dex_farms', async (req, res) => {
			console.trace('get_dex_farms', req.query);
			//filter white list
			let data = await this.db.get_dex_farms(req.query.farmer_id, req.query.farms);
			let n = (await this.db.get_mblocks_height()).height;
			for (let rec of data) {
				rec.apy = null;
				rec.liquidity = null;
				rec.earned = null;
				rec.blocks_left = null;
				if(rec.total_stake > 0) {
					//Token Price
					let tokens_info = await this.db.get_tokens_info([rec.reward_token_hash, rec.stake_token_hash]);
					let reward_token_price = ((tokens_info.find(t => t.hash === rec.reward_token_hash)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.reward_token_hash)).cg_price_usd : (tokens_info.find(t => t.hash === rec.reward_token_hash)).dex_price_usd;
					reward_token_price = reward_token_price === undefined ? 0 : reward_token_price / 1e10;
					let stake_token_price = ((tokens_info.find(t => t.hash === rec.stake_token_hash)).cg_price_usd !== null) ? (tokens_info.find(t => t.hash === rec.stake_token_hash)).cg_price_usd : (tokens_info.find(t => t.hash === rec.stake_token_hash)).dex_price_usd;
					stake_token_price = stake_token_price === undefined ? 0 : stake_token_price / 1e10;

					//Liquidity
					let total_stake_usd = rec.total_stake / Math.pow(10, rec.stake_token_decimals) * stake_token_price;
					rec.liquidity = total_stake_usd;

					//Earned
					if (rec.stake > 0) {
						let _d = (BigInt(n) - BigInt(rec.last_block)) * BigInt(rec.block_reward);
						let distributed = _d < BigInt(rec.emission) ? _d : BigInt(rec.emission);
						let new_level = BigInt(rec.level) + (distributed * Utils.FARMS_LEVEL_PRECISION) / BigInt(rec.total_stake);
						rec.new_level = new_level;
						rec.earned = BigInt(rec.stake) * (new_level - BigInt(rec.farmer_level)) / Utils.FARMS_LEVEL_PRECISION;
					}
					//Blocks left
					let max_n = Number(BigInt(rec.emission) / BigInt(rec.block_reward));
					rec.blocks_left = max_n - (n - rec.last_block);

					//APY
					let block_reward_usd = (rec.block_reward / Math.pow(10, rec.reward_token_decimals)) * reward_token_price;
					console.debug(`block_reward_usd - rec.block_reward = ${rec.block_reward}, rec.reward_token_decimals = ${rec.reward_token_decimals}, reward_token_price = ${reward_token_price}`);
					console.debug(`roi - block_reward_usd = ${block_reward_usd}, total_stake_usd = ${total_stake_usd}`);
					if(block_reward_usd > 0 && total_stake_usd > 0){
						let roi = BigInt(Math.round(block_reward_usd / total_stake_usd * 365 * 5760)) * Utils.PERCENT_FORMAT_SIZE;
						rec.apy = roi;
					}

				}
			}
			res.send(data);
		});

		// TODO: Move to separate route
		this.app.get('/api/v1/ext/plain/circ_supply', async (req, res) => {
			console.trace('circ_supply_plain', req.query);
			let data = await this.servicePlain.get_csup();
			res.send(data);
		});
		this.app.get('/api/v1/ext/plain/total_supply', async (req, res) => {
			console.trace('total_supply_plain', req.query);
			let data = await this.servicePlain.get_tsup();
			res.send(data);
		});
		this.app.get('/api/v1/ext/plain/max_supply', async (req, res) => {
			console.trace('max_supply_plain', req.query);
			let data = await this.servicePlain.get_msup();
			res.send(data);
		});
		this.app.get('/api/v1/ext/plain/hashrate', async (req, res) => {
			console.trace('hashrate_plain', req.query);
			let data = await this.servicePlain.get_network_hashrate();
			res.send(data);
		});
		this.app.get('/api-docs.json', (req, res) => {
		  res.setHeader('Content-Type', 'application/json');
		  res.send(swaggerSpec);
		  console.log(swaggerSpec);
		});
		
		let routes = [];
		this.app._router.stack.forEach(function (r) {
		if (r.route && r.route.path) {
			routes.push(r.route.path)
		}
    });

    this.app.get('/api/v1/list', function (request, response) {
        response.json(routes);
    });
		this.app.use((err, req, res, next) => {
			const status = err.status || 500;
			const msg = err.message;
			console.error(err);
			//console.error(`Error ${status} (${msg}) on ${req.method} ${req.url} with payload ${JSON.stringify(req.body || req.query)}.`);
			if(err instanceof ContractError)
				res.status(200).send({ err: 1, message: msg });
			else
				res.status(status).send({ err: 1, message: 'Something went wrong...' });
		});

		this.app.use(express.static('explorer'));
	}
}

module.exports.Explorer = Explorer;
