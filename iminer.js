const argv = require('yargs').argv;
const fs = require('fs');

const DB = require('./DB').DB;
const Miner = require('./Miner');

const CONFIG_FILENAME = 'config.json';
const MINER_LOAD_LIMIT = 90;

let config = {
	dbhost : 'localhost',
	dbname : 'trinity',
	dbuser : 'root',
	dbpass : '',
	loglevel : 'info',
	load: 10,
	port : 0,
	difficulty: 18,
	reward_ratio : {
		pos : 4000,
		poa: 4000,
		pow: 1600,
		ref: 400,
	},
	mode:'verify'
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

let start_miner = function(config, db) {
	let load = Math.min(config.load, MINER_LOAD_LIMIT);

	console.info(`Starting miner with load ${load}`);
	let miner = new Miner(config, db);
};
/*
let starter =  async function(config, db, callback) {
	if(!db.isConnected){
		setTimeout(starter, 1000, config, db, callback);
		return;
	}
	callback(config, db);
};

starter(config, db, start_miner);
*/
start_miner(config, db);