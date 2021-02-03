/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * inodeapi.js
 * Launcher for Nodeapi module
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const argv = require('yargs').argv;
const fs = require('fs');
const DB = require('./DB').DB;
const NodeAPI = require('./Nodeapi').NodeAPI;
const CONFIG_FILENAME = 'config.json';

let config = {
    dbhost : 'localhost',
    dbname : 'trinity',
    dbuser : 'root',
    dbpass : '',
    loglevel : 'silly'
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

let start_nodeapi = function(config, db) {
    console.info(`Starting nodeAPI`);
    let api = new NodeAPI(config, db);
};
/*
let starter = async function(config, db, callback) {
    if(!db.isConnected){
        setTimeout(starter, 1000, config, db, callback);
        return;
    }
    callback(config, db);
};

starter(config, db, start_nodeapi);
*/

start_nodeapi(config, db);