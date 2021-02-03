/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * iexplorer.js
 * Launcher for blockchain explorer module
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const argv = require('yargs').argv;
const fs = require('fs');

const DB = require('./DB').DB;
const Explorer = require('./Explorer').Explorer;
const Pending = require('./Pending');

const CONFIG_FILENAME = 'config.json';

let config = {
	dbhost : 'localhost',
	dbname : 'trinity',
	dbuser : 'root',
	dbpass : '',
	loglevel : 'info',
	explorer : 80,
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
console.info(`ref_reward_ratio  ${config.ref_reward_ratio}`);

require('console-stamp')(console, {datePrefix: '[', pattern:'yyyy.mm.dd HH:MM:ss', level: config.loglevel, extend:{fatal:0, debug:4, trace:5, silly:6}, include:['silly', 'trace','debug','info','warn','error','fatal']});

let db = new DB({
	host: config.dbhost,
	port: config.dbport,
	user: config.dbuser,
	database: config.dbname,
	password: config.dbpass.toString(),
	dateStrings: true,
	multipleStatements: true,
	useNativeBigInt : false
}, config);
BigInt.prototype.toJSON = function() { return this.toString() }

let start_explorer = function(config, db) {
	let pending = new Pending(db);

	if (config.explorer !== 0) {
		let explorer = new Explorer(config.explorer, db, pending, config.stake_limits, config);
	} else {
		console.info("Explorer is switched OFF");
	}
};
/*
let starter =  async function(config, db, callback) {
	if(!db.isConnected){
		setTimeout(starter, 1000, config, db, callback);
		return;
	}
	callback(config, db);
};

starter(config, db, start_explorer);
*/
start_explorer(config, db);