/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Pending.js
 * TX validation
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const crypto = require('crypto');
const Utils = require('./Utils');
const ContractMachine = require('./SmartContracts');
class Pending {
	constructor(db){
		this.db = db;
		this.CFactory = new ContractMachine.ContractFactory(this.db.app_config);
	}

	async get_txs(count, timeout_s, enable_random){
		let txs = await this.db.pending_peek(count, timeout_s);
		if (enable_random) {
			return [];
		} else {
			return txs;
		}
	}

	get_random_txs(count){
		let txs = [];
		console.warn("Random TXs has been disabled.");
		return txs;
	}

	validate(tx){
		let isValid = Validator.tx(tx);
		if(isValid.err !== 0){
			console.trace(isValid);
			return isValid;
		}
		let hash = Utils.hash_tx_fields(tx);
		let verified = Utils.ecdsa_verify(tx.from, tx.sign, hash);
		console.silly(`Signed message: ${hash} , verified: ${verified}`);

		if (!verified) {
			console.warn('verification failed for transaction: ', JSON.stringify(tx));
			return {err: 1, message: "Signature verification failed"};
		}
		if(this.CFactory.isContract(tx.data)){
			if(!this.CFactory.validate(tx.data)){
				console.warn('Contract validation failed for transaction: ', JSON.stringify(tx));
				return {err: 1, message: "Contract validation failed"};
			}
		}
		return {err: 0};
	}

	async add_txs(tx){
		// todo: hash
		let result = await this.db.pending_add([tx]);
		return {err: 0, result : [{hash: tx.hash, status:0}]};
	}
}
let Validator = {
	txModel : ['amount','data','from','nonce','sign','ticker','to'],
	enq_regexp : /^(02|03)[0-9a-fA-F]{64}$/i,
	hash_regexp : /^[0-9a-fA-F]{64}$/i,
	digit_regexp : /(^0$)|(^[1-9]\d*$)/,
	hex_regexp : /^[A-Fa-f0-9]+$/,
	name_regexp : /^[0-9a-zA-Z _\-/.]{0,512}$/,
	tx : function(tx){

		if(Array.isArray(tx))
			return {err: 1, message: "Only 1 TX can be sent"};

		if(this.txModel.some(key => tx[key] === undefined))
			return {err: 1, message: "Missed fields"};
		if(!this.enq_regexp.test(tx.from))
			return {err: 1, message: "FROM field in not a valid Enecuum address"};
		if(!this.enq_regexp.test(tx.to))
			return {err: 1, message: "TO field in not a valid Enecuum address"};
		if(!this.hash_regexp.test(tx.ticker))
			return {err: 1, message: "Incorrect ticker format, hash expected"};
		if(!((typeof tx.amount === 'string') || (typeof tx.amount === 'number')))
			return {err: 1, message: "Amount should be a string or a number"};
		if(!this.digit_regexp.test(tx.amount))
			return {err: 1, message: "Amount string should be a 0-9 digits only"};
		if(typeof tx.nonce !== 'number')
			return {err: 1, message: "Nonce should be a number"};
		if(!this.name_regexp.test(tx.data))
			return {err: 1, message: "Incorrect data format"};
		if(!this.hex_regexp.test(tx.sign))
			return {err: 1, message: "Incorrect sign format"};
		let amount;
		try{
			if(typeof tx.amount === 'string' && tx.amount.length <= 0)
				return {err: 1, message: "Amount is not a valid Integer"};
			if(typeof tx.amount === 'string' && tx.amount.charAt(0) === "0")
				return {err: 1, message: "Amount is not a valid Integer"};
			amount = BigInt(tx.amount)
		}
		catch(err){
			return {err: 1, message: "Amount is not a valid Integer"};
		}
		if(amount < 0 || amount > Utils.MAX_SUPPLY_LIMIT)
			return {err: 1, message: "Amount is out of range "};
		if(tx.nonce < 0 || tx.nonce > Number.MAX_SAFE_INTEGER)
			return {err: 1, message: "Nonce is out of range "};

		return {err: 0};
	},
	txs : function(txs){
		return {err: 1, message: "Method not implemented yet"};
	}
};
module.exports = Pending;
module.exports.Validator = Validator;