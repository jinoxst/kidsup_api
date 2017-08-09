var cluster = require('cluster');
var numCPUs = require('os').cpus().length;
var worker = require('./worker');
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

function start(route, handle){
	if(cluster.isMaster){
		logger.info('*** Master[' + process.pid + ']');
		for(var i=0;i<numCPUs;i++){
			cluster.fork();
		}
		cluster.on('exit', function(worker, code, signal){
			logger.error('*** Worker[' + worker.process.pid + '] died');
    	cluster.fork();
		});
	}else{
		worker.start(route, handle);
	}
}

exports.start = start;
