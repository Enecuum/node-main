/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * icashier.js
 * Launcher for cashier module
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const argv = require('yargs').argv;
const fs = require('fs');

const DB = require('./DB').DB;
const Cashier = require('./Cashier').Cashier;

const CONFIG_FILENAME = 'config.json';

let config = {
	dbhost : 'localhost',
	dbname : 'trinity',
	dbuser : 'root',
	dbpass : '',
	loglevel : 'info',
	reward_ratio : {
		pos : 4000,
		poa: 4000,
		pow: 1600,
		ref: 400,
	},
	cashier_interval_ms : 1000,
	cashier_chunk_size : 2,
	tail_timeout : 1000
};

console.trace = function (...msg) {
	console.log(...msg);
};

console.debug = function (...msg) {
	console.log(...msg);
};

console.silly = function (...msg) {
	console.log(...msg);
};

console.fatal = function (...msg) {
	console.log(...msg);
	process.exit(1);
};

console.info("Application started");

let config_filename = argv.config || CONFIG_FILENAME;

console.info('Loading config from', config_filename, '...');

let cfg = {};
try {
	cfg = JSON.parse(fs.readFileSync(config_filename, 'utf8'));
	config = Object.assign(config, cfg);
} catch (e) {
	console.info('No configuration file found.')
}

config = Object.assign(config, argv);

console.info(`config = ${JSON.stringify(config)}`);

require('console-stamp')(console, {datePrefix: '[', pattern:'yyyy.mm.dd HH:MM:ss', level: config.loglevel, extend:{fatal:0, debug:4, trace:5, silly:6}, include:['silly', 'trace','debug','info','warn','error','fatal']});

let db = new DB({
	host: config.dbhost,
	port: config.dbport,
	user: config.dbuser,
	database: config.dbname,
	password: config.dbpass.toString(),
	dateStrings: true,
	multipleStatements: true
},config);
BigInt.prototype.toJSON = function() { return this.toString() }

let start_cashier = function(config, db) {
	if (config.cashier_interval_ms) {
		console.info(`Starting cashier with interval ${config.cashier_interval_ms}`);
		let cashier = new Cashier(config, db);
		cashier.start();
	} else {
		console.info(`Cashier is OFF`);
	}
};
/*
let starter =  async function(config, db, callback) {
	if(!db.con.isConnected){
		setTimeout(starter, 1000, config, db, callback);
		return;
	}
	callback(config, db);
};

starter(config, db, start_cashier);
*/
start_cashier(config, db);