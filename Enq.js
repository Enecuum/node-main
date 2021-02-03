/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Enq.js
 * Enecuum crypto library wrapper
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

//let addon = require('./src/Build/Release/addon');
let addon = require('./node_modules/enecuum-crypto/addon');
var crypto = require('crypto');

module.exports = addon;
//module.exports.hashToPoint = hashToPoint; 
module.exports.createPK = createPK;
module.exports.getHash = getHash;
module.exports.toPoint = toPoint;

function toPoint(hash, G, curve){
	//let slice = hash.slice(0, 5);
	let r = addon.BigNumber(hash);
	let H = addon.mul(r, G, curve);
	return H;
}

function createPK(pkey, G, curve){
	//let slice = pkey.slice(0, 5);
	let r = addon.BigNumber(pkey);
	let Q = addon.mul(r, G, curve);
	return Q;
}

function getHash(str){
	return crypto.createHash('sha256').update(str).digest('hex');
}

module.exports.keySharing = function (coalition, ids, Q, msk, curve){
	var q = addon.BigNumber(13);
	var shares = addon.shamir(msk, ids, 3, 2, q);
	// r = hash
	var proj = addon.keyProj(coalition, shares, Q, curve);
	return proj;
}

module.exports.sign = function (M, leadID, G, G0, secret, curve){

	let H_hash = getHash(M.toString() + leadID.toString());
	var H = toPoint(parseInt(H_hash.slice(0, 5), 16), G, curve);
	let isInfinity = 0;
	var q = addon.BigNumber(13);
	do {
		var r2 = addon.getRandom(q);
		var s1 = addon.mul(r2, G0, curve);
		// S2 = r*H + SecKey
		var s2 = addon.mul(r2, H, curve);
		s2 = addon.addPoints(s2, secret, curve);
		isInfinity = s2.isInfinity(curve)
	} while(isInfinity)
	return {
		r : {
			x : s1.x(curve),
			y : s1.y(curve)
		},
		s : {
			x : s2.x(curve),
			y : s2.y(curve)
		}
	};
}

module.exports.sign_tate = function (M, leadID, G0, secret, curve, ecurve){
	//console.log("hash = " + getHash(M.toString() + leadID.toString()));
	var h = addon.BigNumber(getHash(M.toString() + leadID.toString()));

	let res = addon.signTate(h, secret, G0, curve, ecurve);
	return res;
}

module.exports.verify = function (sign, M, PK_LPoS, G, G0, MPK, leadID, p, curve){
	var sx = addon.BigNumber(0);
	var sy = addon.BigNumber(522);
	var S = addon.Point(sx, sy, curve);
	let Q = toPoint(parseInt(PK_LPoS.slice(0, 5), 16), G, curve);
	let H_hash = getHash(M.toString() + leadID.toString());
	var H = toPoint(parseInt(H_hash.slice(0, 5), 16), G, curve);

	var s1 = addon.Point(addon.BigNumber(parseInt(sign.r.x)), addon.BigNumber(parseInt(sign.r.y)), curve);
	var s2 = addon.Point(addon.BigNumber(parseInt(sign.s.x)), addon.BigNumber(parseInt(sign.s.y)), curve);

	var r1 = addon.weilPairing(G0, s2, S, curve);
	//console.log("r1 = e(P, S):\t" + r1.value());

	var b1 = addon.weilPairing(MPK, Q, S, curve);
	//console.log("b1 = e(MPK, Q):\t" + b1.value());

	var c1 = addon.weilPairing(s1, H, S, curve);
	//console.log("c1 = e(R, H1):\t" + c1.value());

	var b1c1 = addon.mmul(b1, c1, p);
	//console.log("r1 = b1 * c1:\t" + b1c1.value());
	if(r1.value() == b1c1.value())
		return 1;
	else
		return 0;
}

module.exports.verify_tate = function (sign, M, PK_LPoS, G0, MPK, leadID, curve, ecurve ){
	var h = addon.BigNumber(getHash(M.toString() + leadID.toString()));
	PK_LPoS = addon.BigNumber(PK_LPoS);
	let Q = addon.getQ(PK_LPoS, curve, ecurve);
	//console.log("Qa: " + Q.xy(curve));
	let res = addon.verifyTate(sign, h, Q, G0, MPK, curve, ecurve);
	return res;
}