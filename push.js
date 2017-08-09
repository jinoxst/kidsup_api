var gcm = require('node-gcm');
var apn = require('apn');
var config = require('./config').config;
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

var androidOptions = {
	collapseKey: config.push.android.collaseKey,
	delayWhileIdle: config.push.android.delayWhileIdle,
	timeToLive: config.push.android.timeToLive
}; 

var iosOptions = {
	cert: config.push.ios.cert,
	key: config.push.ios.key,
	gateway: config.push.ios.gateway,
	port: config.push.ios.port
}

/*function pushForAndroid(options, tokens){
	var message = new gcm.Message(options);
	var sender = new gcm.Sender(config.push.android.apiKey);
	var buckets = [];
	var bucket = [];
	tokens.forEach(function(d, idx){
		if(idx > 0 && bucket.length % 1000 == 0){
			buckets.push(bucket);
			bucket = [];
		}
		bucket.push(d);
	});
	if(bucket.length > 0){
		buckets.push(bucket);
		bucket = null;
	}
	buckets.forEach(function(registrationIds, idx){
		sender.send(message, registrationIds, config.push.android.retryCnt, function(err, result){
			if(err){
				logger.error(err);
			}else{
				logger.info(result);
			}
		});
	});
}*/

function pushForAndroid(arr, pool){
	var sender = new gcm.Sender(config.push.android.apiKey);
	arr.forEach(function(d, idx){
		var message = new gcm.Message(androidOptions);
		message.addDataWithObject({
			alert: d.alert,
			custom: d.custom
		});
		var registrationId = [d.token];
		sender.send(message, registrationId, config.push.android.retryCnt, function(err, result){
			if(err){
				logger.error(err);
			}else{
				logger.info(result);
				if(result.canonical_ids === 1){
					var canonicalId = result.results[0].registration_id;
					if(canonicalId){
						var param = [registrationId];
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								logger.info('expire token:' + param);
								conn.query('CALL expireDeviceToken(?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										logger.info(rs);
									}
								});
							}
						});
					}
				}
			}
		});
	});
}

/*function pushForIOS(params, tokens){
	var conn = new apn.Connection(iosOptions);
	conn.on('connected', function(){
		logger.info('apns connected');
	});
	conn.on('transmitted', function(result, device){
		var token = device['token'].toString('hex');
		var payload = result['compiledPayload'];
		logger.info('transmitted to APNS info -> ' + token + ' - ' + payload);
	});
	conn.on('transmissionError', function(errCode, result, device){
		var token = 'Unknown';
		if(device && device['token']){
			token = device['token'].toString('hex');
		}
		logger.error('apns transmissionError -> error code:' + errCode + ', token:' + token);
	});
	conn.on('timeout', function(){
		logger.info('Connection timeout APNS');
	});
	conn.on('disconnected', function(){
		logger.info('Disconnected from APNS');
	});
	var note = new apn.Notification();
	note.expiry = Math.floor(Date.now() / 1000) + 3600;
	var alert = params.alert;
	if(alert.length > config.push.alertLength){
		alert = alert.substring(0,config.push.alertLength) + '...';
	}
	note.alert = alert;
	note.payload = params.payload;
	note.badge = 1;
	var devices = [];
	tokens.forEach(function(d, idx){
		devices.push(new apn.Device(d));
	});
	conn.pushNotification(note, devices);
}*/

function pushForIOS(arr){
	var conn = new apn.Connection(iosOptions);
	conn.on('connected', function(){
		logger.info('apns connected');
	});
	conn.on('transmitted', function(result, device){
		var token = device['token'].toString('hex');
		logger.info('transmitted to APNS info -> ' + token + ' - ' + result['compiled']);
	});
	conn.on('transmissionError', function(errCode, result, device){
		var token = 'Unknown';
		if(device && device['token']){
			token = device['token'].toString('hex');
		}
		logger.error('apns transmissionError -> error code:' + errCode + ', token:' + token);
	});
	conn.on('timeout', function(){
		logger.info('Connection timeout APNS');
	});
	conn.on('disconnected', function(){
		logger.info('Disconnected from APNS');
	});
	arr.forEach(function(d, idx){
		var note = new apn.Notification();
		note.expiry = Math.floor(Date.now() / 1000) + 3600;
		var alert = d.alert;
		if(alert.length > config.push.alertLength){
			alert = alert.substring(0,config.push.alertLength) + '...';
		}
		note.alert = alert;
		note.payload = d.payload;
		note.badge = 1;
		note.sound = config.push.ios.sound;
		var device = [new apn.Device(d.token)];
		conn.pushNotification(note, device);
	});
}

/*function unitPushProcess(d, threadType, threadId){
	var androidTokens = [];
	var iOSTokens = [];
	if(d.device_type === '1'){
		iOSTokens.push(d.device_token);
		var params = {
			alert: d.alert,
			payload: { 
				custom: {
					thread_type: threadType,
					thread_id: threadId 
				}
			}
		}
		pushForIOS(params, iOSTokens);
	}else if(d.device_type === '2'){
		androidTokens.push(d.device_token);
		androidOptions['data'] = {
			alert: d.alert,
			custom: {
				thread_type: threadType,
				thread_id: threadId
			}
		}
		pushForAndroid(androidOptions, androidTokens);
	}
}*/

function unitPushProcess(d, threadType, threadSubType, threadId, pool){
	var androidArr = [];
	var iOSArr = [];
	if(d.device_type === '1'){
		var data = {
			token: d.device_token,
			alert: d.alert,
			payload: { 
				custom: {
					thread_type: threadType,
					thread_subtype: threadSubType,
					thread_id: threadId 
				}
			}
		};
		iOSArr.push(data);
	}else if(d.device_type === '2'){
		var data = {
			token: d.device_token,
			alert: d.alert,
			custom: {
				thread_type: threadType,
				thread_subtype: threadSubType,
				thread_id: threadId
			}
		};
		androidArr.push(data);
	}
	if(iOSArr.length > 0){
		pushForIOS(iOSArr);
	}
	if(androidArr.length > 0){
		pushForAndroid(androidArr, pool);
	}
}


function doNoticeTargetList(pool, noticeId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [noticeId];
			conn.query('CALL getNoticeTargetPushList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '1', '1', noticeId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doNoticeReplyAdd(pool, noticeId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [noticeId];
			conn.query('CALL getNoticeReplyAddPushInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '1', '2', noticeId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doNoticeReadOver(pool, noticeId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [noticeId];
			conn.query('CALL getNoticeReadOverPushInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '1', '', noticeId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doEventTargetList(pool, eventId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [eventId];
			conn.query('CALL getEventTargetPushList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '3', '1', eventId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doEventReplyAdd(pool, eventId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [eventId];
			conn.query('CALL getEventReplyAddPushInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '3', '2', eventId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doEventReadOver(pool, eventId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [eventId];
			conn.query('CALL getEventReadOverPushInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '3', '', eventId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doApproveManagerList(pool, member_id, kids_id, invitation_result){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [member_id, kids_id, invitation_result];
			conn.query('CALL getApproveRequestPushList(?,?,?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '4', '1', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doApproveRequestSuccess(pool, member_id){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [member_id];
			conn.query('CALL getApproveRequestSuccessInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '5', '', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doApproveRequestReject(pool, member_id){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [member_id];
			conn.query('CALL getApproveRequestRejectInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '8', '', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doMamaTalkReplyAdd(pool, mamatalkId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [mamatalkId];
			conn.query('CALL getMamaTalkReplyAddPushInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '6', '1', mamatalkId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doDailyMenuTargetList(pool, centerId, classId, memberId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [centerId, classId, memberId];
			conn.query('CALL getDailyMenuTargetPushList(?,?,?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '7', '1', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doNotReadNoticeMemberList(pool, noticeId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [noticeId];
			conn.query('CALL getNotReadNoticeMemberList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '1', '', noticeId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doNotReadEventMemberList(pool, eventId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [eventId];
			conn.query('CALL getNotReadEventMemberList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '3', '', eventId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doContactTargetList(pool, contactId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [contactId];
			conn.query('CALL getContactTargetPushList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '2', '1', contactId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doContactReplyAdd(pool, contactId, member_id){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [contactId, member_id];
			conn.query('CALL getContactReplyAddPushInfo(?,?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '2', '2', contactId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doContactReadOver(pool, contactId, member_id){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [contactId, member_id];
			conn.query('CALL getContactReadOverPushInfo(?,?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '2', '', contactId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doNotReadContactMemberList(pool, contactId){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [contactId];
			conn.query('CALL getNotReadContactMemberList(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '2', '', contactId + '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doAttendanceCheckMemberList(pool, centerId, classId, kidsIdStr){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [centerId, classId, kidsIdStr];
			conn.query('CALL getAttendanceCheckMemberList(?,?,?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '9', '1', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}

function doCenterApproveRequestSuccess(pool, center_id){
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
		}else{
			var param = [center_id];
			conn.query('CALL getCenterApproveRequestSuccessInfo(?)',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
				}else{
					if(result[0]){
						result[0].forEach(function(d, idx){
							unitPushProcess(d, '5', '', '', pool);
						});
					}else{
						logger.info('push targetsize is zero');
					}
				}
			});
		}
	});
}
exports.doNoticeTargetList = doNoticeTargetList;
exports.doEventTargetList = doEventTargetList;
exports.doNoticeReplyAdd = doNoticeReplyAdd;
exports.doNoticeReadOver = doNoticeReadOver;
exports.doEventReplyAdd = doEventReplyAdd;
exports.doEventReadOver = doEventReadOver;
exports.doApproveManagerList = doApproveManagerList;
exports.doApproveRequestSuccess = doApproveRequestSuccess;
exports.doApproveRequestReject = doApproveRequestReject;
exports.doMamaTalkReplyAdd = doMamaTalkReplyAdd;
exports.doDailyMenuTargetList = doDailyMenuTargetList;
exports.doNotReadNoticeMemberList = doNotReadNoticeMemberList;
exports.doNotReadEventMemberList = doNotReadEventMemberList;
exports.doContactTargetList = doContactTargetList;
exports.doContactReplyAdd = doContactReplyAdd;
exports.doContactReadOver = doContactReadOver;
exports.doNotReadContactMemberList = doNotReadContactMemberList;
exports.doAttendanceCheckMemberList = doAttendanceCheckMemberList;
exports.doCenterApproveRequestSuccess = doCenterApproveRequestSuccess;
