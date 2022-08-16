/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Stat.js
 * Module for collecting blockchain data and caching
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const StatService = require('./stat.service').StatService;
const StakeCalc = require('./stakecalc.js').StakeCalc;

const day = 24*60*60*1000;
const check_type_timeout = 10*60*1000;
const tokens_ptice_timeout = 5000;

const FULL_NODE = 0;
const POW = 1;
const POA = 2;
const POS = 3;

class Stat {

    constructor(db, config) {
        console.info(`Stat process started`);

        this.db = db;
        this.config = config;
        this.target_speed = config.target_speed;

        this.db.update_stats({['block_time_target'] : this.target_speed});

        this.service = new StatService(db);
        this.service_roi = new StakeCalc(db, config);
        this.handlers = {
            'max_tps' :                 this.service.get_max_tps.bind(this),
            'accounts' :                this.service.get_accounts_count.bind(this),
            'reward_poa' :              this.service.get_poa_reward.bind(this),
            'reward_pow' :              this.service.get_pow_reward.bind(this),
            'reward_pos' :              this.service.get_pos_reward.bind(this),
            'csup' :                    this.service.get_csup.bind(this),
            'tsup' :                    this.service.get_tsup.bind(this),
            'full_count' :              this.service.get_peer_count.bind(this, FULL_NODE),
            'pow_count' :               this.service.get_peer_count.bind(this, POW),
            'poa_count' :               this.service.get_peer_count.bind(this, POA),
            'pos_count' :               this.service.get_peer_count.bind(this, POS),
            'tps' :                     this.service.get_tps.bind(this),
            'total_daily_stake' :       this.service.get_total_daily_stake.bind(this),
            'total_daily_pos_stake' :   this.service.get_total_daily_pos_stake.bind(this),
            'cg_usd' :                  this.service.get_cg_usd.bind(this),
            'cg_btc' :                  this.service.get_cg_btc.bind(this),
            'cg_eth' :                  this.service.get_cg_eth.bind(this),
            'difficulty':               this.service.get_difficulty.bind(this),
            'height':                   this.service.get_height.bind(this),
            'network_hashrate':         this.service.get_network_hashrate.bind(this),
            'engaged_balance':          this.service.get_engaged_balance.bind(this),
            'pos_active_count':         this.service.get_pos_active_count.bind(this),
            'poa_capable_count':        this.service.get_poa_capable_count.bind(this),
            'pos_total_count':          this.service.get_pos_total_count.bind(this),
            'proposed_inflation':       this.service.get_proposed_inflation.bind(this),
            'block_time_30d_avg':       this.service.get_block_time_30d_avg.bind(this),
            'block_time_24h_avg':       this.service.get_block_time_24h_avg.bind(this),
            'txfee_hourly_24h_avg':     this.service.get_txfee_hourly_24h_avg.bind(this),
            'txfee_daily_30d_avg':      this.service.get_txfee_daily_30d_avg.bind(this),
            'update_iptable':           this.service.update_iptable.bind(this)
        };

        this.calcInt = setImmediate(async () => { await this.calcRefs(); }, day);
        this.statsInt = setTimeout(async () => { await this.calсStat(); }, 2000);
        this.recalcRoi = setImmediate(async () => { await this.calcRoi(); }, day);
        this.redefNodesType = setImmediate(async () => { await this.redefNodes(); }, check_type_timeout);
        this.recalcPosPowRew = setImmediate(async () => { await this.calcPosPowRew(); }, day);

        this.tokensPrice = setImmediate(async () => { await this.tokensPriceCaching(); }, tokens_ptice_timeout);
        this.tokensHolders = setImmediate(async () => { await this.tokensHoldersCaching(); }, this.target_speed * 1000);
    }

    async tokensHoldersCaching(){
        await this.db.update_tokens_holder_count();
        setTimeout(async () => {
            await this.tokensHoldersCaching();
        }, this.target_speed * 1000);
    }

    async tokensPriceCaching() {
        let start = new Date();
        let tokens = await this.db.get_tokens_price();
        let price_desimals = 10;
        try {
            let cg_data = [];
            let prices = await this.service.get_cg_tokens_usg(tokens.map(item => {
                return item.cg_id
            }));
            let request_time = new Date();
            let cg_request_time = request_time - start;
            console.debug({cg_request_time});
            tokens.forEach(item => {
                cg_data.push({tokens_hash: item.tokens_hash, price: Math.round(prices[item.cg_id].usd * Math.pow(10, price_desimals))})
            });

            let dex_data = await this.db.get_dex_tokens_price(this.config.native_token_hash, cg_data[cg_data.findIndex(item => item.tokens_hash === this.config.native_token_hash)].price);
            for (let i = 0; i < dex_data.length; i++) {
                if(this.config.dex.DEX_TRUSTED_TOKENS.includes(dex_data[i].tokens_hash)){
                    let trusted_dex_data = await this.db.get_dex_tokens_price(dex_data[i].tokens_hash, dex_data[i].calc_dex_price);
                    dex_data = dex_data.concat(trusted_dex_data);
                }
            }
            //let dex_data = await this.db.get_dex_tokens_price();
            await this.db.update_tokens_price(cg_data, dex_data, price_desimals);
        } catch (e) {
            console.error(e);
        }
        let end = new Date();
        let calcTime = end - start;
        console.debug({calcTime});
        let timeout = tokens_ptice_timeout - calcTime;
        setTimeout(async () => {
            await this.tokensPriceCaching();
        }, timeout);
    }

    async calcRoi(){
        let start = new Date();
        let tokens = await this.db.get_rois();
        try {
            for(let tok of tokens){
                let stakes = tok.calc_stakes.split(';').map(e => parseInt(e));
                if(stakes.length === 0){
                    console.warn(`Empty stakes for token ${tok.token}`);
                    continue;
                }
                let calc_rois_stat = await this.service_roi.calc_average_stat(stakes, 25, tok.token);
                let calc_rois_sim = await this.service_roi.calc_average_sim(stakes, 25, tok.token);
                console.info(`Recalc ROI_stat \tfor token ${tok.token}, old: ${tok.calc_rois}, new: ${calc_rois_stat}`);
                console.info(`Recalc ROI_sim \tfor token ${tok.token}, old: ${tok.calc_rois_sim}, new: ${calc_rois_sim}`);
                await this.db.update_roi(tok.token, calc_rois_stat, calc_rois_sim);
            }
        } catch (e) {
            console.error(e);
        }
        let end = new Date();
        let calcTime = day - (end - start);
        setTimeout(async () => { await this.calcRoi(); }, calcTime);
    }

    async redefNodes(){
        let start = new Date();
        try {
            console.debug('Nodes type redefinition');

            let pow = [];
            let pos = [];

            //get blocks in 10 min
            let count_blocks = check_type_timeout / 1000 / this.target_speed;
            console.debug(`count_blocks ${count_blocks}`);
            let blocks = await this.db.get_lastblocks(count_blocks);
            for (let i = 0; i < blocks.length; i++) {
                if (!pow.includes(blocks[i].publisher))
                    pow.push(blocks[i].publisher);

                let sblocks = await this.db.get_statblocks(blocks[i].hash);
                for (let j = 0; j < sblocks.length; j++) {
                    if (!pos.includes(sblocks[j].publisher))
                        pos.push(sblocks[j].publisher);
                }
            }
            //check and update type
            let clients = await this.db.get_hosts_online();
            console.debug(`pow count ${pow.length} | pos count ${pos.length} `)
            for (let i = 0; i < clients.length; i++) {
                let pow_i = pow.findIndex(pub => pub === clients[i].pub);

                let pos_i = pos.findIndex(pub => pub === clients[i].pub);

                if (pow_i > -1) {
                    if (clients[i].type !== POW)
                    //update pow
                        await this.db.set_client_type(clients[i].ipstring, clients[i].pub, POW);
                } else if (pos_i > -1) {
                    if (clients[i].type !== POS)
                    //update pos
                        await this.db.set_client_type(clients[i].ipstring, clients[i].pub, POS);
                } else
                //update other
                    await this.db.set_client_type(clients[i].ipstring, clients[i].pub, FULL_NODE);
            }
        } catch (e) {
            console.error(e);
        }
        let end = new Date();
        let calcTime = check_type_timeout - (end - start);
        setTimeout(async () => { await this.redefNodes(); }, calcTime);       
    }

    async calcRefs(){
        let start = new Date();
        try {
            console.debug('Recalc refs');
            let accs = await this.db.get_ledger();
            let refstake = (await this.db.get_referrer_stake()).referrer_stake;
            for (let i = 0; i < accs.length; i++) {
                if (accs[i].amount < refstake)
                    continue;
                let acc = await this.db.get_referrals_count(accs[i].id);
                acc.id = accs[i].id;
                if (acc.ref_reward)
                    acc.ref_reward *= 0.1;
                await this.db.put_agent_info(acc);
                //await Utils.sleep(10);
            }
        } catch (e) {
            console.error(e);
        }
        let end = new Date();
        let calcTime = day - (end - start);
        setTimeout(async () => { await this.calcRefs(); }, calcTime);
    }

    async calcPosPowRew() {
        let start = new Date();
        try {
            console.info(`Recalc PoS and PoW daily rewards`);
            let accs = await this.db.get_ledger();
            for (let i = 0; i < accs.length; i++) {
                let acc = await this.db.get_krewards(accs[i].id);
                let acc_s = await this.db.get_srewards(accs[i].id);
                acc.s_reward = acc_s.s_reward;

                if (acc.k_reward || acc.s_reward) {
                    console.info(`acc ${acc.k_reward}  | s_rew ${acc.s_reward}`)
                    acc.id = accs[i].id;
                    await this.db.put_agent_info(acc);
                }
            }
        } catch (e) {
            console.error(e);
        }
        let end = new Date();
        let calcTime = day - (end - start);
        setTimeout(async () => { await this.calcRefs(); }, calcTime);
    }

    async calсStat(){
        try{
            let stats = await this.db.get_stat();
            for(let stat of stats){
                let now = new Date().getTime() / 1000;
                if ((now - stat.calctime >= stat.lifetime) || (stat.lifetime === 0)){
                    if(!this.handlers.hasOwnProperty(stat.key))
                        continue;
                    await this.cacheValue(stat.key, this.handlers[stat.key]);
                }
            }
        }
        catch (e) {
            console.error(e);
        }
        setTimeout(async () => { await this.calсStat(); }, 1000);
    }

    async cacheValue(key, handler){
        let stat = (await this.db.get_stats(key))[0];
        let now = new Date().getTime() / 1000;
        if ((now - stat.calctime >= stat.lifetime) || (stat.lifetime === 0)){
            let newStat = await handler();         
            console.silly(`Recalc ${stat.key}, old: ${stat.value}, new: ${newStat}`);
            //if(stat.value !== newStat)
                await this.db.update_stats({[stat.key] : newStat});
        }
    }
}

module.exports.Stat = Stat;