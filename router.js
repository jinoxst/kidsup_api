var requestHandlers = require('./requestHandlers');
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

function route(handle, pathname, req, res) {
	if(handle[pathname] && (typeof handle[pathname] === 'function')){
		handle[pathname](req, res);
	}else{
		logger.error('BAD REQUEST');
		requestHandlers.sendCommonResponse(res, 400, 'Bad Request');
	}
}

exports.route = route;
