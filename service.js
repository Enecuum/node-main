/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * service.js
 * Service script
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');
const fs = require('fs');
const argv = require('yargs').argv;
const DB = require('./DB').DB;

const CONFIG_FILENAME = 'config.json';

let config = {
    dbhost : 'localhost',
    dbname : 'trinity',
    dbuser : 'root',
    dbpass : ''
};

BigInt.prototype.toJSON = function() { return this.toString() };

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

console.info("Service script started");

let config_filename = argv.config || CONFIG_FILENAME;

console.info('Loading config from', config_filename, '...');

let cfg = {};
try {
    cfg = JSON.parse(fs.readFileSync(config_filename, 'utf8'));
    config = Object.assign(config, cfg);
} catch (e) {
    console.info('No configuration file found.');
}

config = Object.assign(config, argv);
console.info(`config = ${JSON.stringify(config)}`);

require('console-stamp')(console, {datePrefix: '[', pattern:'yyyy.mm.dd HH:MM:ss', level: config.loglevel, extend:{fatal:0, debug:4, trace:5, silly:6}, include:['silly', 'trace','debug','info','warn','error','fatal']});

//while (!db.isConnected);
let db = new DB({
    host: config.dbhost,
    port: config.dbport,
    user: config.dbuser,
    database: config.dbname,
    password: config.dbpass.toString(),
    dateStrings: true,
    multipleStatements: true
}, config);

let service = async function(config, db) {
    /*
    if (!db.isConnected) {
        setTimeout(service, 1000, config, db);
        return;
    }
    */
    console.info(`Connected`);
    await db.request("SET GLOBAL max_allowed_packet=1073741824;");
    switch (config.service_mode) {
        case 'remove':
            if (config.n !== undefined) {
                let snapshot_info = await db.get_snapshot_before(config.n);
                let snapshot = await db.get_snapshot(snapshot_info.hash);
                console.info(`before snapshot_hash = ${snapshot.hash}`);
                let result_delete = await db.delete_kblocks_after(config.n);
                console.info({result_delete});
            } else
                console.warn(`parameter '--n' not specified./nBlock number after which you want to delete history`);
            break;
        case 'recalc':
            if (config.n !== undefined) {
                let snapshot_info = await db.get_snapshot_before(config.n);
                let snapshot = await db.get_snapshot(snapshot_info.hash);
                console.info(`before snapshot_hash = ${snapshot.hash}`);
                let snapshot_json = '';
                try {
                    snapshot_json = JSON.parse(snapshot.data);
                } catch (e) {
                    console.error(`Invalid snapshot data. Not parsed JSON:`, e);
                    process.exit(-1);
                }
                //Rollback calculation
                let result_rollback = await db.rollback_calculation(snapshot_info.n);
                console.info({result_rollback});
                //Init snapshot
                let result_init = await db.init_snapshot(snapshot_json);
                console.info({result_init});
            } else
                console.warn(`parameter '--n' not specified./nBlock number before which the snapshot will be found`);
            break;
        case 'recalc_mroot':
            let tail = await db.peek_tail();
            let kblocks = await db.peek_range(84000, tail.n);
            console.log(`peek range (0, ${tail.n})`);
            for (let i = 0; i < kblocks.length; i++) {
                let included_mblocks = await db.get_included_microblocks(kblocks[i].link);
                let included_sblocks = await db.get_included_statblocks(kblocks[i].link);
                let snapshot_hash = await db.get_snapshot_hash(kblocks[i].link);
                let recalc_m_root = Utils.merkle_root(included_mblocks, included_sblocks, snapshot_hash);

                if(recalc_m_root !== kblocks[i].m_root)
                    console.warn(`${i} | After recalc block, changed m_root: before ${kblocks[i].m_root}, after ${recalc_m_root}`);
            }
            console.info(`Done`);
            break;
        case 'pid_simulation':
            let history = [];
            let ki = 0.01;
            let HR = 1000;
            let diff =0;
            let t=0;
            for(let i =0; i<100000; i++){
                if(i>100) {
                    let arr = history.slice(0, 100);
                    let arr_last = history.slice(1, 101);
                    let avg_diff = arr.reduce(function (a, b) {
                        return a + b.target_diff;
                    }, 0) / arr.length;
                    let input = arr.reduce(function (a, b) {
                        return a + b.time;
                    }, 0) / arr.length;
                    let last_input = arr_last.reduce(function (a, b) {
                        return a + b.time;
                    }, 0) / arr_last.length;
                    let Iterm = 0;
                    let Iterm_arr = history.slice(0, 200);
                    for (let j = 0; j < 100; j++) {
                        let tmp_arr = Iterm_arr.slice(j, j + 100);
                        Iterm += (tmp_arr.reduce(function (a, b) {
                            return a + b.target_diff;
                        }, 0) / tmp_arr.length) * ki;
                    }
                    diff = avg_diff + Utils.PID(input, last_input,15,  Iterm);
                    t = fake_miner(diff, HR);
                }

                history.insert(0, {n:i, time: t, target_diff: diff});
                console.log(`${Math.floor(t)} ${Math.floor(diff)}`);
            }
            let average = history.reduce(function (a, b) {
                return a + b.time;
            }, 0) / history.length;
            console.log({average});
            fs.writeFile ("result.json", JSON.stringify(history), function(err) {
                    if (err) throw err;
                    console.log('complete');
                }
            );
            break;
        default:
            console.warn(`Incorrect parameter '--service_mode'./nValid values: 'recalc' | 'remove'`);
            break;
    }
    process.exit(1);
};

Array.prototype.insert = function ( index, item ) {
    this.splice( index, 0, item );
};

function fake_miner(diff, hr){
    let und_diff = Utils.understandable_difficulty(diff);
    let t = Math.pow(2, und_diff) / hr;
    return t * randn_bm();
}

function randn_bm() {
    var u = 0, v = 0;
    while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
    while(v === 0) v = Math.random();
    let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );
    num = num / 10.0 + 0.5; // Translate to 0 -> 1
    if (num > 1 || num < 0) return randn_bm(); // resample between 0 and 1
    return num;
}

service(config, db);