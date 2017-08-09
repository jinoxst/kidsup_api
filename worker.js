var http = require("http");
var https = require('https');
var fs = require('fs');
var url = require('url');
var config = require('./config').config;
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

function start(route, handle){
	function onRequest(req, res) {
		if(req.url == '/favicon.ico'){
			return;
		}
		var remoteAddress = req.connection.remoteAddress;
		var pathname = url.parse(req.url).pathname;
		logger.info('[REQ] ' + req.method + ' ' + req.url + ' [' + remoteAddress + ']');
		route(handle, pathname, req, res);
	}

	if(config.serverType == 'https'){
		var options = {
			key: fs.readFileSync(config.https.key),
			cert: fs.readFileSync(config.https.cert),
			passphrase: config.https.passphrase
		};
		/*var options = {
			key: fs.readFileSync(config.https_bak.key),
			cert: fs.readFileSync(config.https_bak.cert),
			ca: fs.readFileSync(config.https_bak.ca)
		};*/
		var server = https.createServer(options, onRequest);
		server.listen(config.https.port, function(){
			logger.info('*** HttpsServer[' + process.pid + '] is running[mode:' + process.env.NODE_ENV + ']...');
		});

		server.on('clientError', function(e){
			logger.error('*** Https Client Error:' + e.message);
		});

		server.on('error', function(e){
			logger.error('*** HttpsServer[' + process.pid + '] Error:' + e.message);
			logger.error(e);
		});
	}else{
		var server = http.createServer(onRequest);
		server.listen(config.http.port, function(){
			logger.info('*** HttpServer[' + process.pid + '] is running[mode:' + process.env.NODE_ENV + ']...');
		});

		server.on('clientError', function(e){
			logger.error('*** Http Client Error:' + e.message);
		});

		server.on('error', function(e){
			logger.error('*** HttpServer[' + process.pid + '] Error:' + e.message);
		});
	}
}

exports.start = start;
