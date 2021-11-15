/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * stat.service.js
 * Stat module business logic
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const Utils = require('./Utils');

let prev_max_tps = 0;

class StatService {

    constructor(db) {
        this.db = db;
        this.init_max_tps();
    }

    async init_max_tps(){
        prev_max_tps = (await this.db.get_stats('max_tps'))[0].value;
    }

    async get_tps(){
        let tmp = await this.db.get_tps(300);
        return tmp.tps;
    };

    async get_max_tps(){
        let tmp = await this.db.get_tps(300);
        if(prev_max_tps == null || prev_max_tps < tmp.tps)
            prev_max_tps = tmp.tps;
        return prev_max_tps;
    };

    async get_total_daily_stake(){
        let tmp = await this.db.count_total_daily_stake();
        return tmp.stake !== null ? tmp.stake : 0;
    }

    async get_total_daily_pos_stake(){
        let tmp = await this.db.count_total_daily_pos_stake();
        return tmp.stake !== null ? tmp.stake : 0;
    }

    async get_csup() {
        let exclude = [
            '0270a88ea6f7c5ea2a2ec3878008d878a70fd5d4ca27d5866d0eec3594cab0b912',
            '026df0aa41967d8d47082c36b29a164aa1c90cdd07cb02d373daaba90b8eca5301'
        ];
        let circ = BigInt((await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0].total_supply);
        for(let wallet of exclude){
            let balance = await this.db.get_balance(wallet, Utils.ENQ_TOKEN_NAME);
            circ -= BigInt(balance.amount);
        }
        return circ;
    };

    // Can be changed by token info
    async get_tsup(){
        let tmp = await this.db.get_total_supply();
        return tmp.amount;
    };

    // async get_msup(){
    //     let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];
    //     return token_enq.max_supply;
    // };

    async get_cg_usd(){
        let tmp = await Utils.http.get('https://api.coingecko.com/api/v3/simple/price',
            {
                ids : 'enq-enecuum',
                vs_currencies : 'usd'
            });
        return tmp['enq-enecuum'].usd;
    };

    async get_cg_btc(){
        let tmp = await Utils.http.get('https://api.coingecko.com/api/v3/simple/price',
            {
                ids : 'enq-enecuum',
                vs_currencies : 'btc'
            });
        return tmp['enq-enecuum'].btc;
    };

    async get_cg_eth(){
        let tmp = await Utils.http.get('https://api.coingecko.com/api/v3/simple/price',
            {
                ids : 'enq-enecuum',
                vs_currencies : 'eth'
            });
        return tmp['enq-enecuum'].eth;
    };

    async get_accounts_count(){
        let tmp = await this.db.get_accounts_count();
        return parseInt(tmp.count);
    };

    async get_poa_reward(){
        let tmp = await this.db.get_poa_reward();
        return tmp.reward;
    }

    async get_pow_reward(){
        let tmp = await this.db.get_pow_reward();
        return tmp.reward;
    }

    async get_pos_reward(){
        let tmp = await this.db.get_pos_reward();
        return tmp.reward;
    }

    async get_peer_count(type){
        let tmp = await this.db.get_peer_count(type);
        return tmp.count === undefined ? 0 : tmp.count;
    }

    async get_difficulty(){
        let data = await this.db.get_difficulty(5760);
        return data.difficulty;
    }

    async get_height(){
        let height = await this.db.get_mblocks_height();
        // Update pos uptime
        let db_data = {
            n : (height.height - 1 - 5760)
        };
        let stat = await this.db.get_pos_statuses(db_data);
        await this.db.update_pos_statuses(stat);

        return height.height;
    }

    async get_network_hashrate(){
         let data = await this.db.get_difficulty(5760);
        return Math.pow(2, data.difficulty);
    }

    async get_engaged_balance(){
        let pos_stake = (await this.db.get_stats('total_daily_pos_stake'))[0].value;
        let poa_stake = (await this.db.get_stats('total_daily_stake'))[0].value;
        return BigInt(pos_stake) + BigInt(poa_stake);
    }

    async get_pos_active_count(){
        let poses = await this.db.get_pos_contract_all();
        let res = 0;
        for(let pos of poses){
            if(pos.uptime > 0)
                res++;
        }
        return res;
    }

    async get_poa_capable_count(){
        let res = await this.db.get_staking_poa_count();
        return res.total;
    }

    async get_pos_total_count(){
        let poses = await this.db.get_pos_contract_all();
        return poses.length;
    }

    async get_proposed_inflation(){
        let token_enq = (await this.db.get_tokens_all([Utils.ENQ_TOKEN_NAME]))[0];
        let year_bloock_count = 60 * 60 * 24 * 365 / this.db.app_config.target_speed;
        return year_bloock_count * token_enq.block_reward / token_enq.total_supply;
    }

    async get_block_time_30d_avg(){
        let monthly = 5760 * 30;
        let res = await this.db.get_avg_block_time(monthly);
        return res;
    }

    async get_block_time_24h_avg(){
        let daily = 5760;
        let res = await this.db.get_avg_block_time(daily);
        return res;
    }

    async get_txfee_hourly_24h_avg(){
        let daily = 5760;
        let res = (await this.db.get_tx_count_ranged(daily + 1))[0];
        return res.count / 24;
    }

    async get_txfee_daily_30d_avg(){
        let monthly = 5760 * 30;
        let res = (await this.db.get_tx_count_ranged(monthly + 1))[0];
        return res.count / 30;
    }

    async update_iptable(){
        let unresolved_ips = await this.db.get_unresolved_ips();
        unresolved_ips = unresolved_ips.slice(0, 50);
        console.silly(`unresolved_ips = `, JSON.stringify(unresolved_ips));
        let batch = unresolved_ips.map((ip) => {return {query:ip.ipstring.split(':')[0], fields:"status,query,city,country,countryCode,lat,lon"}});
        console.silly('batch = ', JSON.stringify(batch));
        let url = 'http://ip-api.com/batch';
        if(this.config.ip_api_key !== undefined){
            url = 'http://pro.ip-api.com/batch?key=' + this.config.ip_api_key;
        }
        if (batch.length > 0) {
            let res = await Utils.http.post(url, batch);
            if(res !== undefined && res !== 'Unprocessable Entity\n') {
                if (res.length > 0) {
                    let values = res.filter(x => x.status === 'success')
                                    .map(x => [x.query, x.country.replace(/[\\$'"]/g, "\\$&"),
                                        x.countryCode, x.city.replace(/[\\$'"]/g, "\\$&").substr(0,40),
                                        x.lat, x.lon]);
                    if(values.length > 0){
                        this.db.update_iptable([values]);
                    }
                }
            }
            else {
                console.info('IP-API empty response');
            }
        }
    }
}

module.exports.StatService = StatService;