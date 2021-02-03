/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * stakecalc.js
 * ROI calculator
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const mysql = require('mysql');

let params = {
	kblocks_per_sec : 1 / 15,
	mblocks_per_sec : 1 / 15,
	max_tps : 1,
	txs_per_microblock : 1,
	poa_share : 0.3181,
	reward_per_macroblock : 30460000000,
	duration_s : 24 * 60 * 60,
	//groups : [{stake: 25e10, count: 100}, {stake: 35e10, count: 100}, {stake: 25000e10, count: 100}],
};

class StakeCalc {

	constructor(db, config) {
		console.info("Recalc Roi started");

		this.db = db;

		this.config = config;

		require('console-stamp')(console, {datePrefix: '[', pattern:'yyyy.mm.dd HH:MM:ss', level: config.loglevel, extend:{fatal:0, debug:4, trace:5, silly:6}, include:['silly', 'trace','debug','info','warn','error','fatal']});

		db.request("SET sql_mode=(SELECT REPLACE(@@sql_mode, 'ONLY_FULL_GROUP_BY', ''))");
	}

	factor(n){
		if (n < 50) {
			let f = 1;
			for (let i = 1; i <= n; i++)
				f *= i;
			return f;
		} else {
			if (n <= 1)
				return 1;
			return Math.sqrt(2 * Math.PI * n) * Math.pow((n / Math.E), n);
		}
	};

	c(n, k){
		return this.factor(n) / (this.factor(k) * this.factor(n - k));
	};

	poisson(p, n){
		let dens = [];
		let prob = [];

		let sum = 0;
		for (let i = 0; i <= n; i++){

			lambda = p * n;
			let x = Math.pow(lambda, i) * Math.pow(Math.E, -1 * lambda) / this.factor(i);

			dens.push(x);
			sum += x;
			prob.push(sum);

			if (sum >= 1.0)
				break;
			if (x == 0)
				break;
		}

		return {dens, prob, name: "Poisson"};
	};

	gauss(p, n){
		let dens = [];
		let prob = [];

		return {dens, prob, name : "Gauss"};
	};

	uniform(p, n){
		let r = Math.round(n * p);
		let prob = new Array(r).fill(0);

		prob.push(1);

		return {prob, name : "uniform"};
	};

	stub(p, n){
		let dens = [1];
		let prob = [1];

		return {dens, prob, name : "UNKNOWN"};
	};

	binomial(p, n){
		let dens = [];
		let prob = [];
		let coeffs = [];

		let sum = 0;

		for (let i = 0; i <= n; i++){
			let C = this.c(n, i);
			let x = C * Math.pow(p, i) * Math.pow(1 - p, n - i);

			coeffs.push(C);
			dens.push(x);
			sum += x;
			prob.push(sum);
		}

		return {dens, prob, coeffs, name : "binomial"};
	};

	rnd(prob){
		let r = Math.random();
		for (let i = 0; i < prob.length; i++){
			if (prob[i] >= r)
				return i;
		}
		return prob.length - 1;
		//console.error(`bad prob for ${r}`);
	};

	async calculator(params, token){
		let {kblocks_per_sec, mblocks_per_sec, max_tps, txs_per_microblock, poa_share, reward_per_macroblock, duration_s, groups} = params;

		let token_data = (await this.db.request(`select * from tokens where hash = "${token}"`))[0];

		reward_per_macroblock =  token_data.block_reward;

		// calculated values
		let total_reward = reward_per_macroblock * poa_share * 24 * 60 * 60 * kblocks_per_sec;
		let total_stake = groups.reduce((acc, bin) => acc + bin.stake * bin.count, 0);
		let poa_total = groups.reduce((acc, bin) => acc + bin.count, 0);
		let poa_allowed = max_tps / txs_per_microblock / mblocks_per_sec;
		let bit_filter = Math.max(Math.ceil(Math.log2(poa_total / poa_allowed)), 0);
		let p = Math.min(poa_allowed / poa_total, 1.0);

		groups.forEach((g) => {
			if (g.count < 50){
				g.prob = this.binomial(p, g.count);
			} else if (g.count * p <= 20){
				g.prob = this.poisson(p, g.count);
			} else if (g.count <= 10000000){
				g.prob = this.uniform(p, g.count);
			} else {
				g.prob = this.stub(p, g.count);
			}
			g.reward = 0;
			g.block_mined = 0;
		});

		let experiment_count = duration_s * kblocks_per_sec;
		for (let n = 0; n < experiment_count; n++){
			let block = groups.map(s => {return {stake : s.stake, count: this.rnd(s.prob.prob)}});
			let stake_sum = block.reduce((acc, el) => acc + el.stake * el.count, 0);
			let roi_coin = (reward_per_macroblock * poa_share) / stake_sum;

			block.forEach((st, i) => {
				groups[i].reward += st.stake * st.count * roi_coin
				groups[i].block_mined += st.count * (1 / kblocks_per_sec * mblocks_per_sec);
			});
		}

		groups.forEach(g => {
			g.reward_per_user = g.reward / g.count;
			g.roi = g.reward_per_user / g.stake;
		});

		return {groups, total_reward, total_stake, poa_total, poa_allowed, bit_filter, p};
	};

	async get_roi(params, stake, token){
		console.silly(`ROI_sim 1`);
		let altered_params = Object.assign(params);
		let i = altered_params.groups.findIndex(g => g.stake === stake);
		if (i === -1) {
			altered_params.groups.unshift({stake, count: 1});
		} else {
			altered_params.groups[i].count++;
		}

		console.silly(`ROI_sim start_calc`);
		let result = await this.calculator(altered_params, token);
		//console.silly(`ROI_sim results : ${JSON.stringify(result)}`);
		//console.silly(result);
		let g = result.groups.find(g => g.stake === stake);
		//console.silly(`ROI_sim group : ${JSON.stringify(g)}`);
		let {roi, reward_per_user} = g;
		console.silly(`ROI_sim group : ${roi}, ${reward_per_user}`);
		return {roi, reward_per_user};
	};

	async get_groups_sqrt() {
		let ledger = await this.db.request(`SELECT ledger.amount FROM (SELECT DISTINCT mblocks.publisher AS pub FROM kblocks LEFT JOIN mblocks ON mblocks.kblocks_hash = kblocks.hash WHERE kblocks.time > unix_timestamp() - 24*60*60) t LEFT JOIN ledger on ledger.id = t.pub where ledger.amount >= 25e10 order by amount ASC;`);
		ledger = ledger.map(x => x.amount);
		//console.silly(`${JSON.stringify(ledger)}`);
		let count = ledger.length;
		let bin_count = Math.floor(Math.sqrt(ledger.length));
		let bins = [];

		let min = ledger[0];
		let max = ledger[ledger.length - 1];
		let bin_interval = (max - min) / bin_count;

		console.silly(min, max, bin_count, bin_interval);

		for (let i = 1; i <= bin_count; i++){
			bins.push({stake: i / bin_count * max, count: 0});
		}

		ledger.forEach(x => {
			//		bins[].count++;
			let i = Math.floor((x-1) * bin_count/max);
			//console.silly(i);
			bins[i].count++;
		});

		bins = bins.filter(b => b.count !== 0);

		console.silly(bins);
		return bins;
	};

	async get_groups(token) {
		let ledger = await this.db.request(`SELECT ledger.amount FROM (SELECT DISTINCT mblocks.publisher AS pub
		FROM kblocks LEFT JOIN mblocks ON mblocks.kblocks_hash = kblocks.hash
		WHERE kblocks.time > unix_timestamp() - 24*60*60 AND mblocks.token='${token}')
		t LEFT JOIN ledger on ledger.id = t.pub where ledger.amount >= 25e10 order by amount ASC;`);

		ledger = ledger.map(x => x.amount);
		let bin_count = Math.floor(Math.sqrt(ledger.length));
		let bin_volume = ledger.length / bin_count;
		let bins = [];

		let stake_sum = ledger.reduce((a, c) => a += c, 0);
		//console.silly(bin_count, bin_volume, stake_sum / 1e10);

		for (let i = 0; i < bin_count; i++){
			bins.push({stake: 0, count: 0, stake_sum: 0});
		}

		for (let i = 0; i < ledger.length; i++){
			let k = Math.floor(i / bin_volume);
			//let k = i % bin_count;
			bins[k].count++;
			bins[k].stake_sum += ledger[i];
		}

		bins.forEach(b => b.stake = b.stake_sum / b.count);
		bins = ledger.map(x => {return {stake:x, count: 1}});
		return bins;
	};

	async do_job(stakes) {
		let groups = await this.get_groups();
		params.groups = groups;

		let rois = [];

		stakes.forEach(s => {
			let {roi, reward_per_user} = this.get_roi(params, s);
			console.silly(`${s/1e10}\t\t${roi}\t\t${reward_per_user/1e10}`);
			rois.push(s + reward_per_user);
		});
		let sql = mysql.format("INSERT INTO stat (`key`,`value`) VALUES ('calc_stakes',?),('calc_rois',?) ON DUPLICATE KEY UPDATE value = values(value);", [stakes.join(";"), rois.map(e => Math.round(e)).join(";")]);
		console.silly(sql);
	};

	async calc_average_stat(stakes, count, token) {
		let when = [];
		for (let i = 0; i < stakes.length - 1; i++){
			when.push(`when amount between ${stakes[i]} and ${stakes[i + 1] - 1} then '${stakes[i + 1]}'`)
		}
		let sql = `select
					case
					${when.join('\n')}
					end as \`range\`,
					CAST(avg(amount)/1e10 as unsigned) as avg_amount,
					avg(m_reward)/avg(amount) as roi
					FROM
					(Select m_count, L.amount as amount, M.m_rew as m_reward FROM (select mblocks.publisher, count(*) as m_count, sum(mblocks.reward) as m_rew FROM mblocks
					left join kblocks on mblocks.kblocks_hash = kblocks.hash
					where included = 1 and (kblocks.n > (select max(n) from kblocks) - 5760) and token = '${token}' group by mblocks.publisher) as M
					left join ledger as L on L.id = M.publisher and L.token = '${token}')
					as T
					group by \`range\`
					order by avg_amount`;

		let stats = await this.db.request(sql);

		if(stats.length === 0)
			return null;
		let result = stakes.map(stake => {
			let row = stats.find(row => row.range >= stake);
			return row ? (stake * (1 + row.roi)) : (stake * (1+ stats[stats.length - 1].roi));
		});
		return result.join(";");
		//return rois_avg.map(e => Math.round(e)).join(";");
	}

	async calc_average_sim(stakes, count, token){
		let rois_avg = Array.from(stakes, () => 0);
		let groups = await this.get_groups(token);
		params.groups = groups;

		console.log('ROI_sim started');

		let actual_count = count; //можем получить меньше наборов из-за выбраковки

		for (let i = 0; i < count; i++){

			let rois = [];

			for (let k = 0; k < stakes.length; k++){
				//stakes.forEach(async function(s)  {
				let s = stakes[k];
				console.log(`ROI_sim get_roi ${s}`);
				let tmp = await this.get_roi(params, s, token);
				let {roi, reward_per_user} = tmp;
				//console.silly(`${s/1e10}\t\t${roi}\t\t${reward_per_user/1e10}`);
				rois.push(s + reward_per_user);
				//});
			}

			//if at least one value in the array is null then skip
			if (rois.some(x => isNaN(x)) || rois.some(x => x===null)) {
				console.debug(`ROI_sim Skip NaN and null values : ${JSON.stringify(rois)}`);
				actual_count--;
				continue;
			} else {
				console.debug(`ROI_sim rois : ${JSON.stringify(rois)}`);
			}

			for (let j = 0; j < rois_avg.length; j++){
				rois_avg[j] += rois[j];
			}
		}

		console.log('ROI_sim actual_count', actual_count);

		rois_avg = rois_avg.map( e => e / actual_count );

		console.silly(`result = `);

		for (let i = 0; i < rois_avg.length; i++){
			console.silly(`${stakes[i]}\t${rois_avg[i]}\t${rois_avg[i]-stakes[i]}\t${(rois_avg[i]-stakes[i]) / stakes[i]}`);
		}

		return rois_avg.map(e => Math.round(e)).join(";");
	}
}

module.exports.StakeCalc = StakeCalc;