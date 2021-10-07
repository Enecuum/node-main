/**
 * Node Trinity source code
 * See LICENCE file at the top of the source tree
 *
 * ******************************************
 *
 * Transport.js
 * Module for interprocess communications within node
 *
 * ******************************************
 *
 * Authors: K. Zhidanov, A. Prudanov, M. Vasil'ev
 */

const http = require('http');

const QUERY_INTERVAL = 3000;
const PEER_FAIL_LIMIT = 10;

let call_count = 0;
let unicast_count = 0;
let call_list = {};
let host_list = {};

class Transport {

	constructor(config, db) {
		this.PROTOCOL_VERSION = 3;
		this.peers = [];
		this.methods_map = {query : "on_query"};
		this.events_map = {};
		this.port = config.port;
		this.client_id = config.id;
		this.db = db;

		console.info('Starting server at ::', this.port);
		http.createServer(this.serverFunc.bind(this)).listen(this.port);

		this.hubid = `hub${config.id}`;
		//this.hubid = `trinityhub`;

		this.ipc = require('node-ipc');
		this.ipc.config.silent = true;
		this.ipc.config.id = this.hubid;
		this.ipc.config.retry = 100;
		this.ipc.serve(this.ipc_callback.bind(this));
		this.ipc.server.start();

		this.callback_counter = 0;
	}

	ipc_callback(){
		// TODO: destroyedSocketID is always = false
		this.ipc.server.on('socket.disconnected', function(socket, destroyedSocketID) {
				console.debug(' ipc client ' + destroyedSocketID + ' has disconnected!');
			}
		);

		this.ipc.server.on('broadcast', function(message){
				let {method, data} = message;
				this.broadcast(method, data);
			}.bind(this)
		);

		this.ipc.server.on('selfcast', function(message){
				let {method, data} = message;
				this.selfcast(method, data);
			}.bind(this)
		);

		this.ipc.server.on('unicast', async function(message, ipc_socket) {
				console.silly(`ipc ${this.hubid} got unicast ${JSON.stringify(message)}`);
				let {socket, method, data, callback_name} = message;
				let result = '';
				try {
					result = await this.unicast(socket, method, data);
				} catch (e) {
					result = e;
				}
				this.ipc.server.emit(ipc_socket, callback_name, result);
			}.bind(this)
		);

		this.ipc.server.on('on', function(message, socket){
				console.trace(`ipc ${this.hubid} got ${JSON.stringify(message)}`);
				let {method} = message;

				let f = function (data) {
					return new Promise(function(resolve, reject){
						let callback_name = `callback${this.callback_counter}`;
						this.callback_counter++;
						let killswitch = setTimeout(()=> {this.ipc.server.off(callback_name, "*"); reject(`Killswitch engaged for ${method}`)} , 15000);

						this.ipc.server.on(
							callback_name,
							function (message) {
								console.trace(`ipc ${this.hubid} got ${callback_name} with message'${JSON.stringify(message)}'`);
								clearTimeout(killswitch);
								resolve(message);
								this.ipc.server.off(callback_name, "*");
							}.bind(this)
						);

						let callback = async function (data) {
							this.ipc.server.emit(socket, 'request', {method, data, callback_name});
						}.bind(this);

						callback(data);
					}.bind(this));
				};

				this.on(method, f.bind(this));
			}.bind(this)
		);
	}

	on(name, callback) {
		if(this.events_map[name] === undefined)
			this.events_map[name] = [];
		this.events_map[name].push(callback);
	}

	http_request(socket, method, data){
		return new Promise(function (resolve, reject) {
			let split = socket.split(':');
			let host = split[0];
			let port = split[1] || 80;

			let req = http.request({host, port, method:"POST", headers:'Content-Type: application/json'}, function (res) {
				let data = "";
				res.setEncoding('utf8');
				res.on('data', function (chunk){
					data += chunk;
				});
				res.on('end', function () {
					try {
						let response = JSON.parse(data);
						resolve(response.result);
					} catch (e) {
						console.warn("Failed to parse server response '", data, "'");
						reject();
					}
				})
			});

			req.on('error', function (err) {
				//console.warn(err);
				reject(err);
			});

			let request = {
				"jsonrpc": "2.0",
				method : method,
				params : (data !== undefined) ? data : {}
			};

			//append service information
			request.ver = this.PROTOCOL_VERSION;
			request.port = this.port;

			let post_data = JSON.stringify(request);

			req.write(post_data);
			req.end();
		}.bind(this));
	}

	serverFunc (req, res) {
		let response = {
			"jsonrpc": "2.0"
		};
		if (req.method === 'POST') {
			let request = '';

			req.on('data', function (chunk) {
				request += chunk;
			});

			let req_timeout = setTimeout(() => {
				response.error = {
					code: 1,
					message: "Request time exceeded"
				};
				res.write(JSON.stringify(response));
				res.end();
			}, 20000);

			let callback = (async function () {
				call_count++;
				console.debug(`call_count = ${call_count}`);
				try {
					request = JSON.parse(request);
					// TODO: заменить по коду data на params
					request.data = request.params;
					delete (request.params);

					if (call_list[request.method])
						call_list[request.method]++;
					else
						call_list[request.method] = 1;

					console.debug(`call_list ${JSON.stringify(call_list)}`);

					request.host = req.socket.remoteAddress;
					if (request.host.substr(0, 7) === "::ffff:") {
						request.host = request.host.substr(7);
					}

					if (host_list[request.host])
						host_list[request.host]++;
					else
						host_list[request.host] = 1;
					console.debug(`host_list ${JSON.stringify(host_list)}`);

					res.writeHead(200, "OK", {'Content-Type': 'application/json'});

					if (request.ver !== this.PROTOCOL_VERSION) {
						console.warn("Ignore request, incorrect protocol version", request.ver);
						response.error = {
							code: 1,
							message: `Protocol version mismatch, ${this.PROTOCOL_VERSION} requiered`
						};
						res.write(JSON.stringify(response));
					} else if (request.data === undefined) {
						console.debug(`Ignore request, no params field provided. method ${request.method}, from ${request.host}:${request.port}`);
						response.error = {
							code: 1,
							message: `No 'params' field provided`
						};
						res.write(JSON.stringify(response));
					} else if (this.events_map[request.method]) {
						console.silly(`got request ${request.method} from ${request.host}:${request.port}`);
						let result = '';
						try {
							if(Array.isArray(this.events_map[request.method])){
								for(callback of this.events_map[request.method]){
									await callback(request);
								}
								result = 1;
							}else
								result = await this.events_map[request.method](request);
						} catch (e) {
							result = e;
						}
						response.result = result;
						res.write(JSON.stringify(response));
					} else if (this.methods_map[request.method]) {
						console.silly('method called', request.method);
						let result = this[this.methods_map[request.method]](request);
						response.result = result;
						res.write(JSON.stringify(response));
					} else {
						console.trace("Method not implemented", request.method);
						response.error = {
							code: 1,
							message: "Method not implemented"
						};
						res.write(JSON.stringify(response));
					}
				} catch (e) {
					console.error(`Callback error: ${e.message}`);
				} finally {
					clearTimeout(req_timeout);
					call_list[request.method]--;
					host_list[request.host]--;
					call_count--;
					res.end();
				}
			}).bind(this);

			req.on('end', callback);
		} else {
			response.error = {
				code: 1,
				message: "Only post requests are supported"
			};
			res.write(JSON.stringify(response));
			res.end();
		}
	};

	add_peer(peer){
		console.silly(`add_peer ${JSON.stringify(peer)}`);
		if( peer.id === undefined && !peer.primary){
		    return;
        }else if (peer.id === this.client_id){
			return;
		}

		let modified = false;

		let i = this.peers.findIndex((p => p.socket === peer.socket));

		if (i > -1){
			if (!('id' in this.peers[i])){
				this.peers[i].id = peer.id;
				modified = true;
			}
		} else {
			modified = true;
			this.peers.push(peer);
		}

		if (modified){
			console.debug("Peers modified:", JSON.stringify(this.peers));
			console.info(`add peer ${peer.socket}`);
			this.db.add_client(peer.socket, peer.id, 1, 0);
			if (this.events_map['new_peer']){
				this.events_map['new_peer'][0](peer.socket);
			}
		}
	}

	connect(socket){
		if (socket)
			this.add_peer({socket, primary: true});

		setInterval(this.query.bind(this), QUERY_INTERVAL);
	}

	update_peers(peers){
		console.silly(`update_peers ${JSON.stringify(peers)}`);
		peers.forEach(p => {
		    if(!p.socket.startsWith("172.") && !p.socket.startsWith("127.") && !p.socket.startsWith("localhost"))
			    this.add_peer(p);
		});
	}

	broadcast(method, data){
		this.peers.forEach((peer) => {
			console.trace(`brodcast->sending ${method} to ${JSON.stringify(peer)}`);
			this.http_request(peer.socket, method, data)
				.catch(err => console.debug("Broadcast failed, cannot connect to", peer.socket));
		});
	}

	unicast(socket, method, data) {
		console.silly(`unicast to ${socket}:${method} ${JSON.stringify(data)}`);
		return this.http_request(socket, method, data)
			.catch(err => console.debug("Unicast failed, cannot connect to", socket));
	}

	selfcast(method, data){
		return this.http_request(`localhost:${this.port}`, method, data)
			.catch(err => console.debug("Unicast failed, cannot connect to localhost"));
	}

	query(){
		this.peers.forEach((peer) => {
			console.debug(`query peer ${JSON.stringify(peer)}`);
			this.http_request(peer.socket, "query", {id : this.client_id, port : this.port})
				.then((r)=>{
					this.update_peers(r);
					peer.failures = 0;
					this.db.set_client_state(peer.socket, peer.id, 1);
				})
				.catch((ex)=>{
					this.db.set_client_state(peer.socket, peer.id, 0);
					peer.failures++;
					console.debug("Query failed, cannot connect to", peer.socket);
				});
		});

		this.peers = this.peers.filter(peer => {
			if (peer.primary === true)
				return true;

			if ('failures' in peer){
				return (peer.failures < PEER_FAIL_LIMIT);
			} else {
				return true;
			}
		});
	}

	on_query(msg) {

		if (msg.data.id !== this.client_id) {
			this.add_peer({id : msg.data.id, socket : [msg.host, msg.data.port].join(':')});
		}
		return this.peers.map(peer => {
			if (peer.failures < PEER_FAIL_LIMIT) {
				let r = {};
				r.socket = peer.socket;
				r.id = peer.id;
				return r;
			} else {
				return null;
			}
		}).filter(peer => peer != null);
	}
}

class Tip {
	constructor(hub_id, client_id){
		this.hubid = `hub${hub_id}`;

		if (!client_id){
			console.warn(`ipc id not specified, generating...`);
			client_id = Math.floor(Math.random() * 1e10);
		}

		this.ipc = require('node-ipc');
		this.ipc.config.silent = true;
		this.ipc.config.id = client_id;
		this.ipc.config.retry = 100;

		this.events_map = {};

		this.callback_counter = 0;

		this.ipc.connectTo(this.hubid, this.connect_func.bind(this));
	}

	connect_func() {
		this.ipc.of[this.hubid].on('connect', function () {
			console.silly(`ipc ${this.ipc.config.id} connected to ${this.hubid}`);
			Object.keys(this.events_map).forEach(e => this.ipc.of[this.hubid].emit('on', {method: e}));
		}.bind(this));

		this.ipc.of[this.hubid].on('disconnect', function () {
			console.silly(`ipc ${this.ipc.config.id} disconnected from ${this.hubid}`);
		}.bind(this));

		this.ipc.of[this.hubid].on('message', function (data) {
			console.silly(`ipc ${this.ipc.config.id} got message from ${this.hubid} ${data}`);
		}.bind(this));

		this.ipc.of[this.hubid].on('request', async function (message) {
			console.silly(`ipc ${this.ipc.config.id} request from ${this.hubid} ${JSON.stringify(message)}`);
			let result = '';
			try {
				result = await this.events_map[message.method](message.data);
			} catch (e) {
				result = e;
			}
			this.ipc.of[this.hubid].emit(message.callback_name, result);
		}.bind(this));
	}

	on(name, callback) {
		this.events_map[name] = callback;
		this.ipc.of[this.hubid].emit('on', {method:name});
	}

	unicast(socket, method, data){
		unicast_count++;
		console.debug(`unicast_count = ${unicast_count}`);
		//FIX должен возвращать промис, потому что вызов делается через await
		return new Promise(function (resolve, reject) {
			let callback_name = `callback${this.ipc.config.id}${this.callback_counter}`;
			this.callback_counter++;

			let killswitch = setTimeout(()=> {unicast_count--; this.ipc.of[this.hubid].off(callback_name, "*"); reject("Killswitch engaged")} , 15000);

			this.ipc.of[this.hubid].on(callback_name, function (message) {
					unicast_count--;
					console.silly(`ipc ${this.ipc.config.id} got ${callback_name} with message '${JSON.stringify(message)}'`);
					this.ipc.of[this.hubid].off(callback_name, "*");
					clearTimeout(killswitch);
					resolve(message);
				}.bind(this)
			);
			this.ipc.of[this.hubid].emit('unicast', {socket, method, data, callback_name});
		}.bind(this));
	}

	broadcast(method, data){
		this.ipc.of[this.hubid].emit('broadcast', {method, data});
	}

	selfcast(method, data){
		this.ipc.of[this.hubid].emit('selfcast', {method, data});
	}
}

module.exports.Hub = Transport;
module.exports.Tip = Tip;