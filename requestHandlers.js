var url = require('url');
var mysql = require('mysql');
var fs = require('fs');
var config = require('./config').config;
var util = require('./util');
var qs = require('querystring');
var unzip = require('unzip');
var gm = require('gm');
var imagic = gm.subClass({imageMagick: true});
var async = require('async');
var push = require('./push');
var mail = require('./mail');
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

var jsonHeader = {
	'Content-Length': 0,
	'Content-Type':'application/json; charset=utf-8',
	'Connection':'close'
}
var commonHeader = {
	'Content-Length': 0,
	'Content-Type':'text/html',
	'Connection':'close'
}
var pool = mysql.createPool({
	host     : config.db.host, 
	database : config.db.database,
	user     : config.db.user,
	password : config.db.password
});

pool.on('connection', function(connection){
	connection.query('SET NAMES ' + config.db.charset);
});

function setJsonHeaderLength(json){
	jsonHeader['Content-Length'] = Buffer.byteLength(json);
}

function setCommonHeaderLength(msg){
	commonHeader['Content-Length'] = Buffer.byteLength(msg);
}

function sendResponse(req, res, j){
	var remoteAddress = req.connection.remoteAddress;
	var json = JSON.stringify(j);
	setJsonHeaderLength(json);
	res.writeHead(200, jsonHeader);
	res.write(json);
	res.end();
	var pathname = url.parse(req.url).pathname;
	logger.info('[RES] ' + pathname + ' result -> status:'+j.status+', message:'+j.message + ' [' + remoteAddress + ']');
}

function sendCommonResponse(res, status, msg){
	setCommonHeaderLength(msg);
	res.writeHead(status, commonHeader);
	res.write(msg);
	res.end();
}

function login(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.email && p.email.trim() && p.pw && p.pw.trim()){
		if(util.isValidEmailAddress(p.email.trim())){
			var param = [p.email.trim(), p.pw.trim()];
			logger.info(param)
			pool.getConnection(function(err, conn){
				if(err){
					logger.error(err.message);
					json = {status:'-99',message:'System Error'};
					sendResponse(req, res, json);
				}else{
					conn.query('CALL login(?,?)',param, function(err, result){
						conn.release();
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							var rs = result[0][0];
							logger.info(rs);
							if(rs.login_result == 1){
								json['member'] = { 
									id: rs.member_id + '',
									center_id: rs.center_id + '',
									center_name: rs.center_name + '',
									name: rs.member_name,
									phonenum: rs.phonenum,
									img: rs.member_img == '' ? '' : config.http.url + '' + rs.member_img,
									type: rs.member_type,
									subtype: rs.member_subtype,
									approval_state: rs.approval_state + '',
									class_id: rs.class_id + '',
									class_name: rs.class_name,
									admin_yn: rs.admin_yn
								};
								pool.getConnection(function(err, conn){
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										conn.query('CALL getMemberClassList(?)',[rs.member_id], function(err, result){
											conn.release();
											if(err){
												logger.error(err.message);
												json = {status:'-99',message:'System Error'};
												sendResponse(req, res, json);
											}else{
												if(result[0]){
													var class_cnt = result[0].length;
													json['class_cnt'] = class_cnt;
													var classObj = [];
													result[0].forEach(function(d, idx){
														classObj.push({
															id: d.id + '',
															name: d.name,
															desc: d.desc
															});
														});
													json['class'] = classObj;
												}else{
													json['class_cnt'] = 0;
												}
												sendResponse(req, res, json);
											}
										});
									}
								});
							}else{
								json = {status:'-5',message:'login fail'};
								sendResponse(req, res, json);
							}
						}
					});
				}
			});
		}else{
			json = {status:'-11',message:'email format error'};
			sendResponse(req, res, json);
		}
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function emailCheck(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.email && p.email.trim()){
		var param = [p.email.trim()];
		logger.info(param);
		if(util.isValidEmailAddress(p.email.trim())){
			pool.getConnection(function(err, conn){
				if(err){
					logger.error(err.message);
					json = {status:'-99',message:'System Error'};
					sendResponse(req, res, json);
				}else{
					conn.query('CALL emailCheck(?)',param, function(err, result){
						conn.release();
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							var rs = result[0][0];
							logger.info(rs);
							if(rs.email_check == 1){
								json = {status:'-7',message:'email is duplicated'};
							}
							sendResponse(req, res, json);
						}
					});
				}
			});
		}else{
			logger.info('*** email check ng');
			json = {status:'-11',message:'email format error'};
			sendResponse(req, res, json);
		}
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function access(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id){
		var param = [p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL access(?)',param, function(err, result){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0] && result[0].length > 0){
							var rs = result[0][0];
							var kids_cnt = rs.kids_id ? result[0].length : 0;
							var centerId = rs.member_center_id;
							json['member'] = {
								id: rs.member_id + '',
								name: rs.member_name,
								phonenum: rs.phonenum,
								type: rs.member_type,
								subtype: rs.member_subtype,
								center_id: rs.member_center_id + '',
								center_name: rs.member_center_name + '',
								approval_state: rs.member_approval_state + '',
								class_id: rs.member_class_id + '',
								class_name: rs.member_class_name + '',
								img: rs.member_img == '' ? '' : config.http.url + '' + rs.member_img,
								admin_yn: rs.admin_yn,
								kids_cnt: kids_cnt
							};
							if(kids_cnt > 0){
								var kids = [];
								result[0].forEach(function(d, idx){
									kids.push({
										id: d.kids_id + '',
										name: d.kids_name,
										img: d.kids_img == '' ? '' : config.http.url + '' + d.kids_img,
										birthday: d.birthday,
										sex: d.sex,
										active: d.active,
										approval_state: d.approval_state + '',
										center_id: d.center_id + '',
										center_name: d.center_name,
										center_type: d.center_type,
										class_id: d.class_id + '',
										class_name: d.class_name,
										registtime: d.registtime,
										country_id: d.country_id + '',
										country_name: d.country_name,
										state_id: d.state_id + '',
										state_name: d.state_name,
										city_id: d.city_id + '',
										city_name: d.city_name
									});
								});
								json['member']['kids'] = kids;
							}

							var param = [p.member_id];
							conn.query('CALL getDeviceTokens(?)',param, function(err, result){
								if(err){
									json['device_cnt'] = 0;
									sendResponse(req, res, json);
									logger.error(err.message);
								}else{
									var device_cnt = result[0].length;
									json['device_cnt'] = device_cnt;
									if(device_cnt > 0){
										var devices = [];
										result[0].forEach(function(d, idx){
											logger.info(d);
											var device = {
												id: d.id + '',
												type: d.type,
												token: d.token,
												locale: d.locale
											};
											devices.push(device);
										});
										json['devices'] = devices;
									}else{
										json['device_cnt'] = 0;
									}
									conn.query('CALL getMemberClassList(?)',[p.member_id], function(err, result){
										conn.release();
										if(err){
											logger.error(err.message);
											json = {status:'-99',message:'System Error'};
											sendResponse(req, res, json);
										}else{
											if(result[0]){
												var class_cnt = result[0].length;
												json['class_cnt'] = class_cnt;
												var classObj = [];
												result[0].forEach(function(d, idx){
													classObj.push({
														id: d.id + '',
														name: d.name,
														desc: d.desc
														});
													});
												json['class'] = classObj;
											}else{
												json['class_cnt'] = 0;
											}
											sendResponse(req, res, json);
											/*conn.query('CALL getMessageTime(?)',[centerId], function(err, result){
												conn.release();
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													var rs = result[0];
													if(rs){
														json['message_time'] = {
															set_yn: rs[0].message_time_set_yn,
															s_hour: rs[0].message_time_s_hour,
															s_min:  rs[0].message_time_s_min,
															e_hour: rs[0].message_time_e_hour,
															e_min:  rs[0].message_time_e_min
														};
													}
													sendResponse(req, res, json);
												}
											});*/
										}
									});
								}
							});
						}else{
							json = {status:'-6',message:'no member info'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNoticeList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.pageno && p.pagesize){
		var param = [p.center_id];
		if(p.class_id){
			param.push(p.class_id);
		}else{
			param.push(-1);
		}
		param.push(p.member_id);
		param.push(p.pageno);
		param.push(p.pagesize);
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getNoticeList(?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var notice_cnt = result[0].length;
							json['notice_cnt'] = notice_cnt;
							var notice = [];
							result[0].forEach(function(d, idx){
								var noticeTmp = {
									id: d.notice_id + '',
									type: d.notice_type,
									title: d.title, 
									contents: d.contents,
									goodcnt: d.goodcnt,
									status: d.status + '',
									createtime: d.createtime,
									readyn: d.readyn,
									readtime: d.readtime,
									writer: {
										id: d.writer_id + '',
										type: d.writer_type,
										name: d.writer_name,
										img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
									},
									reply_cnt: d.reply_cnt,
									schedule_added_yn: d.schedule_added_yn
								};
								var targetTotalCnt = 0;
								var targetReadCnt = 0;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								noticeTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
								if(d.img1 != ''){
									noticeTmp['img1'] = {
										url: config.http.url + '' + d.img1,
										w: d.img1w,
										h: d.img1h
									};
								}
								if(d.img2 != ''){
									noticeTmp['img2'] = {
										url: config.http.url + '' + d.img2,
										w: d.img2w,
										h: d.img2h
									};
								}
								if(d.img3 != ''){
									noticeTmp['img3'] = {
										url: config.http.url + '' + d.img3,
										w: d.img3w,
										h: d.img3h
									};
								}
								if(d.img4 != ''){
									noticeTmp['img4'] = {
										url: config.http.url + '' + d.img4,
										w: d.img4w,
										h: d.img4h
									};
								}
								if(d.img5 != ''){
									noticeTmp['img5'] = {
										url: config.http.url + '' + d.img5,
										w: d.img5w,
										h: d.img5h
									};
								}
								if(d.img6 != ''){
									noticeTmp['img6'] = {
										url: config.http.url + '' + d.img6,
										w: d.img6w,
										h: d.img6h
									};
								}
								if(d.img7 != ''){
									noticeTmp['img7'] = {
										url: config.http.url + '' + d.img7,
										w: d.img7w,
										h: d.img7h
									};
								}
								if(d.img8 != ''){
									noticeTmp['img8'] = {
										url: config.http.url + '' + d.img8,
										w: d.img8w,
										h: d.img8h
									};
								}
								if(d.img9 != ''){
									noticeTmp['img9'] = {
										url: config.http.url + '' + d.img9,
										w: d.img9w,
										h: d.img9h
									};
								}
								if(d.img10 != ''){
									noticeTmp['img10'] = {
										url: config.http.url + '' + d.img10,
										w: d.img10w,
										h: d.img10h
									};
								}
								notice.push(noticeTmp);
								if(d.class_id){
							    notice[idx]['class'] = {
										id: d.class_id,
										name: d.class_name
									}		
								}else{
									notice[idx]['class'] = {
										id: '',
										name: '' 
									}
								}
							});
							json['notice'] = notice;
						}else{
							json['notice_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNoticeDetail(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id){
		var param = [p.notice_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getNoticeDetail(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var d = result[0][0];
						if(d){
							json['notice_cnt'] = 1;
							var notice = [];
							var noticeTmp = {
								id: d.notice_id + '',
								type: d.notice_type,
								title: d.title, 
								contents: d.contents,
								goodcnt: d.goodcnt,
								status: d.status + '',
								createtime: d.createtime,
								readyn: d.readyn,
								readtime: d.readtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							var targetTotalCnt = 0;
							var targetReadCnt = 0;
							if(d.target_totalcnt){
								targetTotalCnt = d.target_totalcnt;
							}
							if(d.target_readcnt){
								targetReadCnt = d.target_readcnt;
							}
							noticeTmp['target'] = {
								total_cnt: targetTotalCnt,
								read_cnt: targetReadCnt
							}
							if(d.img1 != ''){
								noticeTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								noticeTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								noticeTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								noticeTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								noticeTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								noticeTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								noticeTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								noticeTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								noticeTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								noticeTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								noticeTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								noticeTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							notice.push(noticeTmp);
							json['notice'] = notice;
						}else{
							json['notice_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNoticeReplyList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id && p.pageno && p.pagesize){
		var param = [p.notice_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getNoticeReplyList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									notice_id: d.notice_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNoticeReplyList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id && p.pageno && p.pagesize){
		var param = [p.notice_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getNoticeReplyList2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									notice_id: d.notice_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMemberListNotReadNotice(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id){
		var param = [p.notice_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMemberListNotReadNotice(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var member_cnt = result[0].length;
							json['member_cnt'] = member_cnt;
							var member = [];
							result[0].forEach(function(d, idx){
								var obj = {
									member_id: d.member_id + '',
									member_name: d.member_name,
									phonenum: d.phonenum,
									email: d.email,
									kids_id: d.kids_id,
									kids_sex: d.kids_sex,
									kids_name: d.kids_name,
									kids_img: d.kids_img == '' ? '' : config.http.url + '' + d.kids_img,
									class_name: d.class_name
								};
								member.push(obj);
							});
							json['member'] = member;
						}else{
							json['member_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postNoticeContents(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.type && p.center_id && p.member_id && p.title && p.contents){
				var classId = p.class_id ? p.class_id : -1;
				var param = [p.type, p.center_id, classId, p.member_id, p.title, p.contents];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postNoticeContents(?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.notice_id){
									json['notice_id'] = rs.notice_id + '';
									push.doNoticeTargetList(pool, rs.notice_id);
									sendResponse(req, res, json);
								}else{
									json = {status:'-93',message:'post notice contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function getCountryList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	var param = [];
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
			json = {status:'-99',message:'System Error'};
			sendResponse(req, res, json);
		}else{
			conn.query('CALL getCountryList()',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
					json = {status:'-99',message:'System Error'};
					sendResponse(req, res, json);
				}else{
					if(result[0]){
						var country_cnt = result[0].length;
						json['country_cnt'] = country_cnt;
						var country = [];
						result[0].forEach(function(d, idx){
							country.push({
								id: d.id + '',
								name: d.name
							});
						});
						json['country'] = country;
					}else{
						json['country_cnt'] = 0;
					}
					sendResponse(req, res, json);
				}
			});
		}
	});
}

function getStateList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.country_id && p.center_type && p.cnt_flag){
		var param = [p.country_id, p.center_type, p.cnt_flag];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getStateList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var state_cnt = result[0].length;
							json['state_cnt'] = state_cnt;
							var state = [];
							result[0].forEach(function(d, idx){
								state.push({
									id: d.id + '',
									name: d.name,
									center_cnt: d.cnt
								});
							});
							json['state'] = state;
						}else{
							json['state_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getCityList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.state_id && p.center_type && p.cnt_flag){
		var param = [p.state_id, p.center_type,  p.cnt_flag];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getCityList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var city_cnt = result[0].length;
							json['city_cnt'] = city_cnt;
							var city = [];
							result[0].forEach(function(d, idx){
								city.push({
									id: d.id + '',
									name: d.name,
									center_cnt: d.cnt
								});
							});
							json['city'] = city;
						}else{
							json['city_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getCenterList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_type && p.country_id && p.state_id && p.city_id){
		var param = [p.center_type, p.country_id, p.state_id, p.city_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getCenterList(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var center_cnt = result[0].length;
							json['center_cnt'] = center_cnt;
							var center = [];
							result[0].forEach(function(d, idx){
								center.push({
									id: d.id + '',
									name: d.name,
									invitation_code: d.invitation_code
								});
							});
							json['center'] = center;
						}else{
							json['center_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getClassList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getClassList(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var class_cnt = result[0].length;
							json['class_cnt'] = class_cnt;
							var classObj = [];
							result[0].forEach(function(d, idx){
								classObj.push({
									id: d.id + '',
									name: d.name,
									desc: d.desc
								});
							});
							json['class'] = classObj;
						}else{
							json['class_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postNoticeImageZip(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userZipMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id && p.notice_id){
		var middleOrgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.orgDir + '/';
		var middleChgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.chgDir + '/';
		var middleThmDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.thmDir + '/';
		util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
		util.mkdirParent(config.mainImagePath + '' + middleChgDir);
		util.mkdirParent(config.mainImagePath + '' + middleThmDir);

		var bufs = [];
		bufs.totalLength = 0; req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var workDir = config.workImagePath + 'c' + p.center_id + '_' + p.notice_id + '_'  + Date.now();
			fs.mkdir(workDir, function(err){
				if(err){
					logger.error(err);
					json = {status:'-98',message:'File System Error(already exist)'};
					sendResponse(req, res, json);
				}else{
					fs.writeFile(workDir+'/'+config.noticeImageZipName, data, 'binary',  function(err){
						if(err){
							json = {status:'-97',message:'File System Error(ceate zip file)'};
							sendResponse(req, res, json);
						}else{
							logger.info("*** create zip file ok");
							fs.createReadStream(workDir+'/'+config.noticeImageZipName).pipe(unzip.Extract({path: workDir})).on('close', function(){
								fs.readdir(workDir, function(err, files){
									if(err){
										json = {status:'-96',message:'File System Error(readdir)'};
										sendResponse(req, res, json);
									}else{
										var fileList = [];
										var newFileList = [];
										files.filter(function(file){
											return fs.statSync(workDir + '/' + file).isFile() && (config.regexpImageFileExt).test(file);	
										}).forEach(function(file){
											fileList.push(file);
											newFileList.push(util.sha1(workDir + '' + file) + '.' + util.getFileNameExt(file));
										});
										
										var tasks = [];
										newFileList.forEach(function(file, index){
											logger.info(index+' - '+file);
											var orgFile = config.mainImagePath + middleOrgDir + newFileList[index];
											fs.writeFileSync(config.mainImagePath + middleOrgDir + newFileList[index], fs.readFileSync(workDir + '/' + fileList[index]));
											tasks.push(function(next){
												imagic(workDir + '/' + fileList[index]).size(function (err, size) {
													if(err){
														next(null, {orgFile: orgFile, err: true});
													}else{
														if(size && size.width){
															var w = size.width;
															var h = size.height;
															var sFile = workDir + '/' + fileList[index];
															var dFileChg = config.mainImagePath + middleChgDir + file;
															var finalW, finalH;
															if(h >= w){
																if(w >= config.chgWidth){
																	finalW = config.chgWidth;
																	finalH = config.chgWidth * h / w;
																}else{
																	finalW = w;
																	finalH = h;
																}
															}else{
																if(w >= config.chgWidth){
																	finalW = config.chgWidth;
																	finalH = config.chgWidth * h / w;
																}else{
																	finalW = w;
																	finalH = h;
																}
															}
															next(null, {orgFile: orgFile, sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH), file:file, err: false});
														}else{
															next(null, {orgFile: orgFile, err: true});
														}
													}
												});
											});
											tasks.push(function(next){
												imagic(workDir + '/' + fileList[index]).size(function (err, size) {
													if(err){
														next(null, {orgFile: orgFile, err: true});
													}else{
														if(size && size.width){
															var w = size.width;
															var h = size.height;
															var sFile = workDir + '/' + fileList[index];
															var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + file;
															var finalW, finalH;
															if(h >= w){
																if(w >= config.thmWidth){
																	finalW = config.thmWidth;
																	finalH = config.thmWidth * h / w;
																}else{
																	finalW = w;
																	finalH = h;
																}
															}else{
																if(w >= config.thmWidth){
																	finalW = config.thmWidth;
																	finalH = config.thmWidth * h / w;
																}else{
																	finalW = w;
																	finalH = h;
																}
															}
															next(null, {orgFile: orgFile, sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH), err: false});
														}else{
															next(null, {orgFile: orgFile, err: true});
														}
													}
												});
											});
										});
										logger.info('*** tasks.length:'+tasks.length);
										async.series(tasks, function(err, results){
											if(err){
												logger.error(err);
											}else{
												var works = [];
												results.forEach(function(o, idx){
													if(o.err){
														fs.unlink(o.orgFile, function(err){
															if(err) {
																logger.error(err);
															}else{
																logger.info(o.orgFile + ' is deleted successfully');
															}
														});
													}else{
														works.push(function(callback){
															imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
																if(err){
																	logger.error(err);
																	o.err = true;
																}
																callback(null, o);
															});
														});
													}
												});
												logger.info('*** works.length:'+works.length);
												async.series(works, function(err, results){
													if(err){
														logger.error(err);
													}else{
														var imgResults = [];
														results.forEach(function(o, idx){
															if(o.err){
																fs.unlink(o.orgFile, function(err){
																	if(err) {
																		logger.error(err);
																	}else{
																		logger.info(o.orgFile + ' is deleted successfully');
																	}
																});
															}else{
																imgResults.push(o);
																logger.info(o.dFile + ' is done');
															}
														});
														util.deleteFolderRecursive(workDir);
														var holder = '';
														for(var i=0;i<30;i++){
															holder += '?,';
														}
														holder = holder.slice(0, -1);
														var param = [p.notice_id];
														var pIdx = 0;
														imgResults.forEach(function(o, idx){
															if(o.file){
																param[(3 * pIdx) + 1] = o.file;
																param[(3 * pIdx) + 2] = o.w;
																param[(3 * pIdx) + 3] = o.h;
																pIdx++;
															}
														});
														for(var i=0;i<31;i++){
															if(!param[i]){
																param[i] = '';
															}
														}
														pool.getConnection(function(err, conn){
															if(err){
																logger.error(err.message);
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}else{
																logger.info('*** call procedure before param:'+param);
																conn.query('CALL updateNoticeImageName(?,'+holder+')',param, function(err, result){
																	conn.release();
																	if(err){
																		logger.error(err.message);
																		json = {status:'-99',message:'System Error'};
																		sendResponse(req, res, json);
																	}else{
																		var rs = result[0][0];
																		logger.info(rs);
																		if(rs.result == '0'){
																			sendResponse(req, res, json);
																		}else{
																			json = {status:'-92',message:'post notice imagezip error'};
																			sendResponse(req, res, json);
																		}
																	}
																});
															}
														});
													}
												});
											}
										});
									}
								});//fs.readdir
							});//unzip close
						}
					});//write zip file
				}
			});//mkdir workDir
		});//req.on('end');
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postNoticeImage(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id){
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.orgDir + '/';
	var middleChgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.chgDir + '/';
	var middleThmDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleChgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);	

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.notice_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck && post.filename && post.image){
				if(config.regexpImageFileExt.test(post.filename)){
					var filename = util.sha1(post.center_id + '' + post.filename + '' + Date.now()) + '.' + util.getFileNameExt(post.filename);
					param.push(filename);
					var fileFullPath = config.mainImagePath + middleOrgDir + filename;
					fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
						if(err){
							json = {status:'-91',message:'File System Error(image creation)'};
							sendResponse(req, res, json);
						}else{
							var tasks = [];
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileChg = config.mainImagePath + middleChgDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH), sizeSave:true});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH), sizeSave:false});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							logger.info('*** tasks.length:'+tasks.length);
							async.series(tasks, function(err, results){
								if(err){
									json = {status:'-95',message:'File System Error(check image size)'};
									sendResponse(req, res, json);
									logger.error(err);
									results.forEach(function(o, idx){
										fs.unlink(o.sFile, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(o.sFile + ' is deleted successfully');
											}
										});
									});
								}else{
									var works = [];
									results.forEach(function(o, idx){
										works.push(function(callback){
											imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
												callback(err, o);
											});
										});
									});
									logger.info('*** works.length:'+works.length);
									async.series(works, function(err, results){
										if(err){
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											logger.error(err);
											results.forEach(function(o, idx){
												fs.unlink(o.sFile, function(err){
													if(err) {
														logger.error(err);
													}else{
														logger.info(o.sFile + ' is deleted successfully');
													}
												});
											});
										}else{
											var imageW = 0;
											var imageH = 0;
											results.forEach(function(o, idx){
												if(o.sizeSave){
													imageW = o.w;
													imageH = o.h;
												}
												logger.info(o.dFile + ' is done');
											});
											imagic(fileFullPath).quality(config.imageQuality).write(fileFullPath, function(err){
												if(err){
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is done(quality)');
												}
											});
											param.push(imageW);
											param.push(imageH);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info('*** call procedure before param:'+param);
													conn.query('CALL postNoticeImage(?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result > 0){
																sendResponse(req, res, json);
															}else{
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});
										}
									});
								}
							});
						}
					});//end of image file write
				}else{
					json = {status:'-12',message:'image file format invalid'};
					sendResponse(req, res, json);
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
		}
	});//req.on('end');
}

function deleteNoticeImage(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.notice_id && p.filename){
		var param = [p.notice_id, p.filename];
		var middleOrgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.orgDir + '/';
		var middleChgDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.chgDir + '/';
		var middleThmDir = 'c' + p.center_id + '/' + config.noticeDir + '/' + config.thmDir + '/';
		var orgFile = config.mainImagePath + middleOrgDir + '' + p.filename;
		var chgFile = config.mainImagePath + middleChgDir + '' + p.filename;
		var thmFile = config.mainImagePath + middleThmDir + 'thm_' + p.filename;
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteNoticeImage(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result > 0){
							/*
							fs.unlink(orgFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(orgFile + ' is deleted successfully');
								}
							});
							fs.unlink(chgFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(chgFile + ' is deleted successfully');
								}
							});
							fs.unlink(thmFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(thmFile + ' is deleted successfully');
								}
							});
							*/
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteNotice(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id){
		var param = [p.notice_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteNotice(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteNoticeReply(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id && p.reply_id){
		var param = [p.notice_id, p.reply_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteNoticeReply(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function sendNoticeRead(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id && p.member_id){
		var param = [p.notice_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL sendNoticeRead(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doNoticeReadOver(pool, p.notice_id);
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postNoticeReply(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.notice_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var param = [p.notice_id, p.member_id, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postNoticeReply(?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doNoticeReplyAdd(pool, p.notice_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-93',message:'post notice reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postNoticeReply2(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.notice_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var kidsId = p.kids_id ? p.kids_id : -1;
						var param = [p.notice_id, p.member_id, kidsId, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postNoticeReply2(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doNoticeReplyAdd(pool, p.notice_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-93',message:'post notice reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateNoticeContents(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p['content-length'] > 0){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var post = qs.parse(data.toString());
					var param = [
						post.notice_id, 
						post.title, 
						post.contents 
					];
					var paramCheck = true;
					param.forEach(function(d, idx){
						if(d) {
						}else{
							paramCheck = false;
						}
					});
					var classId = post.class_id ? post.class_id : -1;
					param = [post.notice_id, classId, post.title, post.contents];
					logger.info(param);
					if(paramCheck){
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL updateNoticeContents(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result > 0){
											sendResponse(req, res, json);
										}else{
											json = {status:'-99',message:'System Error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postMemberType1Info(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_type, 
				post.center_type, 
				post.country_id, 
				post.state_id, 
				post.city_id,
				post.center_name, 
				post.member_name, 
				post.email, 
				post.pw, 
				post.phonenum,
				post.address_detail
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.email) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL postMemberType1Info(?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																mail.sendMailForServiceStart(post.email, rs.center_id, post.center_name, post.locale);
															}else{
																json = {status:'-87',message:'postMemberType1Info error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL postMemberType1Info(?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										mail.sendMailForServiceStart(post.email, rs.center_id, post.center_name, post.locale);
									}else{
										json = {status:'-87',message:'postMemberType1Info error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function postMemberType2Info(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_type, 
				post.center_type, 
				post.country_id, 
				post.state_id, 
				post.city_id,
				post.center_id, 
				post.member_name, 
				post.email, 
				post.pw, 
				post.phonenum,
				post.invitation_result
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			param.push(post.class_id);
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.email) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											logger.info(dFileThm + ' 1 - w:'+w+', h:'+h);
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL postMemberType2Info(?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
															}else{
																json = {status:'-88',message:'postMemberType2Info error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL postMemberType2Info(?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
									}else{
										json = {status:'-88',message:'postMemberType2Info error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function postMemberType2Info_121(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_type, 
				post.center_type, 
				post.country_id, 
				post.state_id, 
				post.city_id,
				post.center_id, 
				post.member_name, 
				post.email, 
				post.pw, 
				post.phonenum,
				post.invitation_result,
				post.class_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.email) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											logger.info(dFileThm + ' 1 - w:'+w+', h:'+h);
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL postMemberType2Info_121(?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
															}else{
																json = {status:'-88',message:'postMemberType2Info_121 error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL postMemberType2Info_121(?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
									}else{
										json = {status:'-88',message:'postMemberType2Info_121 error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function postMemberType3Info(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.kidsDir + '/' + config.orgDir + '/';
	var middleThmDir = config.kidsDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_type, 
				post.center_type, 
				post.country_id, 
				post.state_id, 
				post.city_id,
				post.center_id, 
				post.member_name, 
				post.email, 
				post.pw, 
				post.phonenum,
				post.kid_name,
				post.kid_birth,
				post.kid_sex,
				post.class_id,
				post.invitation_result
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.email) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL postMemberType3Info(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
															}else{
																json = {status:'-86',message:'postMemberType3Info error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL postMemberType3Info(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, rs.member_id, rs.kids_id, post.invitation_result);
									}else{
										json = {status:'-86',message:'postMemberType3Info error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function updateKidsInfo(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.kidsDir + '/' + config.orgDir + '/';
	var middleThmDir = config.kidsDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_id, 
				post.center_id, 
				post.class_id, 
				post.kids_id, 
				post.kids_name
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var fileSha1 = post.member_id + '_' + post.center_id + '_' + post.class_id + '_' + post.kids_id + Date.now();
						var filename = util.sha1(fileSha1) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info(param);
													conn.query('CALL updateKidsInfo(?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																if(rs.push_flag == '1'){
																	push.doApproveManagerList(pool, rs.member_id, rs.kids_id, '0');
																}
															}else{
																json = {status:'-90',message:'updateKidsInfo error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							logger.info(param);
							conn.query('CALL updateKidsInfo(?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										if(rs.push_flag == '1'){
											push.doApproveManagerList(pool, rs.member_id, rs.kids_id, '0');
										}
									}else{
										json = {status:'-90',message:'updateKidsInfo error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
		}
	});//req.on('end');
}

function addKidsInfo(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.kidsDir + '/' + config.orgDir + '/';
	var middleThmDir = config.kidsDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_id, 
				post.center_id, 
				post.class_id, 
				post.kids_name,
				post.kids_birthday, 
				post.kids_sex, 
				post.kids_active 
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var fileSha1 = post.member_id + '_' + post.center_id + '_' + post.class_id + '_' + Date.now();
						var filename = util.sha1(fileSha1) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL addKidsInfo(?,?,?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																json['kids_id'] = rs.kids_id + '';
																sendResponse(req, res, json);
																push.doApproveManagerList(pool, rs.member_id, rs.kids_id, '0');
															}else{
																json = {status:'-89',message:'addKidsInfo error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL addKidsInfo(?,?,?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										json['kids_id'] = rs.kids_id + '';
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, rs.member_id, rs.kids_id, '0');
									}else{
										json = {status:'-89',message:'addKidsInfo error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
		}
	});//req.on('end');
}

function addAlbumData(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.kids_id && p.center_id && p.thread_type && p.thread_id && p.filename){
		var param = [p.member_id, p.kids_id, p.center_id, p.thread_type, p.thread_id, p.filename];
		logger.info(param);
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL addAlbumData(?,?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == 0){
							json = {status:'-99',message:'System Error'};
						}else if(rs.result == -1){
							json = {status:'-85',message:'duplicate album data'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getAlbumList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.pageno && p.pagesize){
		var param = [p.member_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getAlbumList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var album_cnt = result[0].length;
							json['album_cnt'] = album_cnt;
							var album = [];
							result[0].forEach(function(d, idx){
								album.push({
									member_id: d.member_id + '',
									kids_id: d.kids_id + '',
									idx: d.idx + '', 
									center_name: d.center_name,
									memo: d.memo,
									thumbnail_image: config.http.url + '' + d.thm_img,
									preview_image: config.http.url + '' + d.chg_img,
									thread_time: d.thread_time,
									createtime: d.createtime
								});
							});
							json['album'] = album;
						}else{
							json['album_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getAlbumList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.kids_id && p.pageno && p.pagesize){
		var param = [p.member_id, p.kids_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getAlbumList2(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var album_cnt = result[0].length;
							json['album_cnt'] = album_cnt;
							var album = [];
							result[0].forEach(function(d, idx){
								album.push({
									member_id: d.member_id + '',
									kids_id: d.kids_id + '',
									idx: d.idx + '', 
									center_name: d.center_name,
									memo: d.memo,
									thumbnail_image: config.http.url + '' + d.thm_img,
									preview_image: config.http.url + '' + d.chg_img,
									thread_time: d.thread_time,
									createtime: d.createtime
								});
							});
							json['album'] = album;
						}else{
							json['album_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteAlbumData(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.kids_id && p.album_idx){
		var param = [p.member_id, p.kids_id, p.album_idx];
		logger.info(param);
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteAlbumData(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == 0){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getScheduleList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.month){
		var param = [p.center_id, p.member_id, p.month];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getScheduleList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var schedule_cnt = result[0].length;
							json['schedule_cnt'] = schedule_cnt;
							var schedule = [];
							result[0].forEach(function(d, idx){
								schedule.push({
									date: d.date,
									attendance: d.attendance + '',
									event_cnt: d.event_cnt + ''
								});
							});
							json['schedule'] = schedule;
						}else{
							json['schedule_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getScheduleList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.month){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.center_id, p.member_id, kidsId, p.month];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getScheduleList2(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var schedule_cnt = result[0].length;
							json['schedule_cnt'] = schedule_cnt;
							var schedule = [];
							result[0].forEach(function(d, idx){
								schedule.push({
									date: d.date,
									attendance: d.attendance + '',
									event_cnt: d.event_cnt + ''
								});
							});
							json['schedule'] = schedule;
						}else{
							json['schedule_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getScheduleDetail(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.date){
		var param = [p.center_id, p.member_id, p.date];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getScheduleDetail(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var schedule_cnt = result[0].length;
							json['schedule_cnt'] = schedule_cnt;
							var schedule = [];
							result[0].forEach(function(d, idx){
								schedule.push({
									id: d.id,
									type: d.type,
									deletable: d.deletable,
									center_name: d.center_name,
									class_name: d.class_name,
									date: d.date,
									time: d.time,
									title: d.title,
									detail: d.detail
								});
							});
							json['schedule'] = schedule;
						}else{
							json['schedule_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getScheduleDetail2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.date){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.center_id, p.member_id, kidsId, p.date];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getScheduleDetail2(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var schedule_cnt = result[0].length;
							json['schedule_cnt'] = schedule_cnt;
							var schedule = [];
							result[0].forEach(function(d, idx){
								schedule.push({
									id: d.id,
									type: d.type,
									deletable: d.deletable,
									center_name: d.center_name,
									class_name: d.class_name,
									date: d.date,
									time: d.time,
									title: d.title,
									detail: d.detail
								});
							});
							json['schedule'] = schedule;
						}else{
							json['schedule_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function addScheduleDataByThread(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.date && p.member_id && p.thread_type && p.thread_id){
		var pTime = '';
		if(p.time){
			pTime = p.time;
		}
		var param = [p.center_id, p.date, p.member_id, p.thread_type, p.thread_id, pTime];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL addScheduleDataByThread(?,?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function addScheduleDataByThread2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.date && p.member_id && p.thread_type && p.thread_id){
		var pTime = '';
		if(p.time){
			pTime = p.time;
		}
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.center_id, p.date, p.member_id, kidsId, p.thread_type, p.thread_id, pTime];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL addScheduleDataByThread2(?,?,?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function addScheduleData(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.date && p.member_id && p.title){
				var pDetail = p.detail == '' ? '' : p.detail;
				var pTime = p.time == '' ? '' : p.time;
				var param = [p.center_id, p.date, p.member_id, p.title, pDetail, pTime];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL addScheduleData(?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-82',message:'post class info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function addScheduleData2(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.date && p.member_id && p.title){
				var kidsId = p.kids_id ? p.kids_id : -1;
				var pDetail = p.detail == '' ? '' : p.detail;
				var pTime = p.time == '' ? '' : p.time;
				var param = [p.center_id, p.date, p.member_id, kidsId, p.title, pDetail, pTime];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL addScheduleData2(?,?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-82',message:'post class info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function deleteScheduleData(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.schedule_id){
		var param = [p.schedule_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteScheduleData(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function plusNoticeGoodCnt(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id && p.member_id){
		var param = [p.notice_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL plusNoticeGoodCnt(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getAskApprovalList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.member_type && p.pageno && p.pagesize){
		var param = [p.center_id, p.member_id, p.member_type, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getAskApprovalList(?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var approval_cnt = result[0].length;
							json['approval_cnt'] = approval_cnt;
							var approval = [];
							result[0].forEach(function(d, idx){
								approval.push({
									member_id: d.member_id + '',
									member_name: d.member_name,
									email: d.email,
									phonenum: d.phonenum,
									member_type: d.member_type,
									kids_id: d.kids_id,
									kids_name: d.kids_name,
									kids_birthday: d.kids_birthday,
									kids_sex: d.kids_sex,
									img: d.img == '' ? '' : config.http.url + '' + d.img,
									class_name: d.class_name,
									createtime: d.createtime,
									createtime_ymd: d.createtime_ymd
								});
							});
							json['approval'] = approval;
						}else{
							json['approval_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postDailyMenuData(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id){
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.orgDir + '/';
	var middleChgDir = 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.chgDir + '/';
	var middleThmDir = 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleChgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);	

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.center_id, 
				post.date, 
				post.title,
				post.member_id 
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck && post.filename && post.image){
				if(config.regexpImageFileExt.test(post.filename)){
					var filename = util.sha1(post.center_id + '' + post.filename + '' + Date.now()) + '.' + util.getFileNameExt(post.filename);
					param.push(filename);
					var classId = post.class_id ? post.class_id : -1;
					param.push(classId);
					var fileFullPath = config.mainImagePath + middleOrgDir + filename;
					fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
						if(err){
							json = {status:'-91',message:'File System Error(image creation)'};
							sendResponse(req, res, json);
						}else{
							var tasks = [];
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileChg = config.mainImagePath + middleChgDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH)});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH)});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							logger.info('*** tasks.length:'+tasks.length);
							async.series(tasks, function(err, results){
								if(err){
									json = {status:'-95',message:'File System Error(check image size)'};
									sendResponse(req, res, json);
									logger.error(err);
									results.forEach(function(o, idx){
										fs.unlink(o.sFile, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(o.sFile + ' is deleted successfully');
											}
										});
									});
								}else{
									var works = [];
									results.forEach(function(o, idx){
										works.push(function(callback){
											imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
												callback(err, o);
											});
										});
									});
									logger.info('*** works.length:'+works.length);
									async.series(works, function(err, results){
										if(err){
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											logger.error(err);
											results.forEach(function(o, idx){
												fs.unlink(o.sFile, function(err){
													if(err) {
														logger.error(err);
													}else{
														logger.info(o.sFile + ' is deleted successfully');
													}
												});
											});
										}else{
											results.forEach(function(o, idx){
												logger.info(o.dFile + ' is done');
											});
											imagic(fileFullPath).quality(config.imageQuality).write(fileFullPath, function(err){
												if(err){
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is done(quality)');
												}
											});
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info('*** call procedure before param:'+param);
													conn.query('CALL postDailyMenuData(?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																push.doDailyMenuTargetList(pool, post.center_id, classId, post.member_id);
																sendResponse(req, res, json);
															}else{
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});
										}
									});
								}
							});
						}
					});//end of image file write
				}else{
					json = {status:'-12',message:'image file format invalid'};
					sendResponse(req, res, json);
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
		}
	});//req.on('end');
}

function getDailyMenuList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.pageno && p.pagesize){
		var classId = p.class_id ? p.class_id : -1;
		var param = [p.center_id, classId, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getDailyMenuList(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var dailymenu_cnt = result[0].length;
							json['dailymenu_cnt'] = dailymenu_cnt;
							var dailymenu = [];
							result[0].forEach(function(d, idx){
								var obj = {
									date: d.date,
									menu_cnt: d.menu_cnt
								};
								if(d.menu_cnt == 1){
									obj.menu = [{
										title: d.titles,
										thumbnail_image: d.thm_img == '' ? '' : config.http.url + '' + d.thm_img,
										preview_image: d.chg_img == '' ? '' : config.http.url + '' + d.chg_img,
										writer:{
											id: d.member_id,
											type: d.meber_type,
											name: d.member_name,
											img: d.img == '' ? '' : config.http.url + '' + d.img
										}
									}];
								}else{
									obj.menu = [];
									var chgArr = d.chg_img.split(config.splitDelimiter);
									var thmArr = d.thm_img.split(config.splitDelimiter);
									var titlesArr = d.titles.split(config.splitDelimiter);
									var memberIdArr = d.member_id.split(config.splitDelimiter);
									var memberTypeArr = d.member_type.split(config.splitDelimiter);
									var memberNameArr = d.member_name.split(config.splitDelimiter);
									var memberImgArr = d.member_img.split(config.splitDelimiter);
									for(var i=0;i<chgArr.length;i++){
										obj.menu.push({
											title: titlesArr[i],
											thumbnail_image: thmArr[i] == '' ? '' : config.http.url + '' + thmArr[i],
											preview_image: chgArr[i] == '' ? '' : config.http.url + '' + chgArr[i],
											writer: {
												id: memberIdArr[i],
												type: memberTypeArr[i],
												name: memberNameArr[i],
												img: memberImgArr[i] == '' ? '' : config.http.url + '' + memberImgArr[i]
											}
										});
									}
								}
								dailymenu.push(obj);
							});
							json['dailymenu_cnt'] = dailymenu_cnt;
							json['dailymenu'] = dailymenu;
						}else{
							json['dailymenu_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteDailyMenuData(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.date && p.filename){
		var param = [p.center_id, p.date, p.filename];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteDailyMenuData(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result < 1){
							json = {status:'-99',message:'System Error'};
						}else{
							var deleteTargets = [];
							deleteTargets.push(config.mainImagePath + 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.orgDir + '/' + p.filename);
							deleteTargets.push(config.mainImagePath + 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.chgDir + '/' + p.filename);
							deleteTargets.push(config.mainImagePath + 'c' + p.center_id + '/' + config.dailymenuDir + '/' + config.thmDir + '/thm_' + p.filename);
							deleteTargets.forEach(function(file, idx){
								fs.unlink(file, function(err){
									if(err) {
										logger.error(err);
									}else{
										logger.info(file + ' is deleted successfully');
									}
								});
							});
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function doAskApprove(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.member_type){
		var param = [p.member_id, p.member_type, p.kids_id == '' ? -1 : p.kids_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL doAskApprove(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doApproveRequestSuccess(pool, p.member_id);
						}else{
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteAskApprove(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.member_type){
		var param = [p.member_id, p.member_type, p.kids_id == '' ? -1 : p.kids_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteAskApprove(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doApproveRequestReject(pool, p.member_id);
						}else{
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function activateKids(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.kids_id){
		var param = [p.member_id, p.kids_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL activateKids(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result > 0){
							json.member_center_id = rs.member_center_id + '';
							json.member_class_id = rs.member_class_id + '';
							json.member_img = rs.member_img == '' ? '' : config.http.url + '' + rs.member_img;
						}else{
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postEventContents(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.type && p.center_id && p.member_id && p.title && p.contents){
				var classId = p.class_id ? p.class_id : -1;
				var address = p.address ? p.address : '';
				var date = p.date ? p.date : '';
				var param = [p.type, p.center_id, classId, p.member_id, p.title, p.contents, address, date];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postEventContents(?,?,?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.event_id){
									json['event_id'] = rs.event_id + '';
									push.doEventTargetList(pool, rs.event_id);
									sendResponse(req, res, json);
								}else{
									json = {status:'-84',message:'post event contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function getEventList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.member_id && p.pageno && p.pagesize){
		var param = [p.center_id];
		if(p.class_id){
			param.push(p.class_id);
		}else{
			param.push(-1);
		}
		param.push(p.member_id);
		param.push(p.pageno);
		param.push(p.pagesize);
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getEventList(?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var event_cnt = result[0].length;
							json['event_cnt'] = event_cnt;
							var event = [];
							result[0].forEach(function(d, idx){
								var eventTmp = {
									id: d.event_id + '',
									type: d.event_type,
									title: d.title, 
									contents: d.contents,
									address: d.address,
									date: d.date,
									goodcnt: d.goodcnt,
									status: d.status + '',
									createtime: d.createtime,
									readyn: d.readyn,
									readtime: d.readtime,
									writer: {
										id: d.writer_id + '',
										type: d.writer_type,
										name: d.writer_name,
										img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
									},
									reply_cnt: d.reply_cnt,
								};
								var targetTotalCnt = 0;
								var targetReadCnt = 0;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								eventTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
								if(d.img1 != ''){
									eventTmp['img1'] = {
										url: config.http.url + '' + d.img1,
										w: d.img1w,
										h: d.img1h
									};
								}
								if(d.img2 != ''){
									eventTmp['img2'] = {
										url: config.http.url + '' + d.img2,
										w: d.img2w,
										h: d.img2h
									};
								}
								if(d.img3 != ''){
									eventTmp['img3'] = {
										url: config.http.url + '' + d.img3,
										w: d.img3w,
										h: d.img3h
									};
								}
								if(d.img4 != ''){
									eventTmp['img4'] = {
										url: config.http.url + '' + d.img4,
										w: d.img4w,
										h: d.img4h
									};
								}
								if(d.img5 != ''){
									eventTmp['img5'] = {
										url: config.http.url + '' + d.img5,
										w: d.img5w,
										h: d.img5h
									};
								}
								if(d.img6 != ''){
									eventTmp['img6'] = {
										url: config.http.url + '' + d.img6,
										w: d.img6w,
										h: d.img6h
									};
								}
								if(d.img7 != ''){
									eventTmp['img7'] = {
										url: config.http.url + '' + d.img7,
										w: d.img7w,
										h: d.img7h
									};
								}
								if(d.img8 != ''){
									eventTmp['img8'] = {
										url: config.http.url + '' + d.img8,
										w: d.img8w,
										h: d.img8h
									};
								}
								if(d.img9 != ''){
									eventTmp['img9'] = {
										url: config.http.url + '' + d.img9,
										w: d.img9w,
										h: d.img9h
									};
								}
								if(d.img10 != ''){
									eventTmp['img10'] = {
										url: config.http.url + '' + d.img10,
										w: d.img10w,
										h: d.img10h
									};
								}
								event.push(eventTmp);
								if(d.class_id){
							    event[idx]['class'] = {
										id: d.class_id,
										name: d.class_name
									}		
								}else{
									event[idx]['class'] = {
										id: '',
										name: '' 
									}
								}
							});
							json['event'] = event;
						}else{
							json['event_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getEventDetail(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id){
		var param = [p.event_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getEventDetail(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var d = result[0][0];
						if(d){
							json['event_cnt'] = 1;
							var event = [];
							var eventTmp = {
								id: d.event_id + '',
								type: d.event_type,
								title: d.title, 
								contents: d.contents,
								address: d.address,
								date: d.date,
								goodcnt: d.goodcnt,
								status: d.status + '',
								createtime: d.createtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							var targetTotalCnt = 0;
							var targetReadCnt = 0;
							if(d.target_totalcnt){
								targetTotalCnt = d.target_totalcnt;
							}
							if(d.target_readcnt){
								targetReadCnt = d.target_readcnt;
							}
							eventTmp['target'] = {
								total_cnt: targetTotalCnt,
								read_cnt: targetReadCnt
							}
							if(d.img1 != ''){
								eventTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								eventTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								eventTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								eventTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								eventTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								eventTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								eventTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								eventTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								eventTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								eventTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								eventTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								eventTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							event.push(eventTmp);
							json['event'] = event;
						}else{
							json['event_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postEventImage(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id){
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.orgDir + '/';
	var middleChgDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.chgDir + '/';
	var middleThmDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleChgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);	

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.event_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck && post.filename && post.image){
				if(config.regexpImageFileExt.test(post.filename)){
					var filename = util.sha1(post.center_id + '' + post.filename + '' + Date.now()) + '.' + util.getFileNameExt(post.filename);
					param.push(filename);
					var fileFullPath = config.mainImagePath + middleOrgDir + filename;
					fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
						if(err){
							json = {status:'-91',message:'File System Error(image creation)'};
							sendResponse(req, res, json);
						}else{
							var tasks = [];
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileChg = config.mainImagePath + middleChgDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH), sizeSave:true});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH), sizeSave:false});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							logger.info('*** tasks.length:'+tasks.length);
							async.series(tasks, function(err, results){
								if(err){
									json = {status:'-95',message:'File System Error(check image size)'};
									sendResponse(req, res, json);
									logger.error(err);
									results.forEach(function(o, idx){
										fs.unlink(o.sFile, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(o.sFile + ' is deleted successfully');
											}
										});
									});
								}else{
									var works = [];
									results.forEach(function(o, idx){
										works.push(function(callback){
											imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
												callback(err, o);
											});
										});
									});
									logger.info('*** works.length:'+works.length);
									async.series(works, function(err, results){
										if(err){
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											logger.error(err);
											results.forEach(function(o, idx){
												fs.unlink(o.sFile, function(err){
													if(err) {
														logger.error(err);
													}else{
														logger.info(o.sFile + ' is deleted successfully');
													}
												});
											});
										}else{
											var imageW = 0;
											var imageH = 0;
											results.forEach(function(o, idx){
												if(o.sizeSave){
													imageW = o.w;
													imageH = o.h;
												}
												logger.info(o.dFile + ' is done');
											});
											imagic(fileFullPath).quality(config.imageQuality).write(fileFullPath, function(err){
												if(err){
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is done(quality)');
												}
											});
											param.push(imageW);
											param.push(imageH);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info('*** call procedure before param:'+param);
													conn.query('CALL postEventImage(?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result > 0){
																sendResponse(req, res, json);
															}else{
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});
										}
									});
								}
							});
						}
					});//end of image file write
				}else{
					json = {status:'-12',message:'image file format invalid'};
					sendResponse(req, res, json);
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
		}
	});//req.on('end');
}

function postEventReply(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.event_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var param = [p.event_id, p.member_id, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postEventReply(?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doEventReplyAdd(pool, p.event_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-83',message:'post event reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postEventReply2(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.event_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var kidsId = p.kids_id ? p.kids_id : -1;
						var param = [p.event_id, p.member_id, kidsId, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postEventReply2(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doEventReplyAdd(pool, p.event_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-83',message:'post event reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getEventReplyList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id && p.pageno && p.pagesize){
		var param = [p.event_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getEventReplyList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									event_id: d.event_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getEventReplyList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id && p.pageno && p.pagesize){
		var param = [p.event_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getEventReplyList2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									event_id: d.event_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMemberListNotReadEvent(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id){
		var param = [p.event_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMemberListNotReadEvent(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var member_cnt = result[0].length;
							json['member_cnt'] = member_cnt;
							var member = [];
							result[0].forEach(function(d, idx){
								var obj = {
									member_id: d.member_id + '',
									member_name: d.member_name,
									phonenum: d.phonenum,
									email: d.email,
									kids_id: d.kids_id,
									kids_name: d.kids_name,
									kids_sex: d.kids_sex,
									kids_img: d.kids_img == '' ? '' : config.http.url + '' + d.kids_img,
									class_name: d.class_name
								};
								member.push(obj);
							});
							json['member'] = member;
						}else{
							json['member_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteEventImage(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.event_id && p.filename){
		var param = [p.event_id, p.filename];
		var middleOrgDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.orgDir + '/';
		var middleChgDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.chgDir + '/';
		var middleThmDir = 'c' + p.center_id + '/' + config.eventDir + '/' + config.thmDir + '/';
		var orgFile = config.mainImagePath + middleOrgDir + '' + p.filename;
		var chgFile = config.mainImagePath + middleChgDir + '' + p.filename;
		var thmFile = config.mainImagePath + middleThmDir + 'thm_' + p.filename;
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL deleteEventImage(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result > 0){
							/*
							fs.unlink(orgFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(orgFile + ' is deleted successfully');
								}
							});
							fs.unlink(chgFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(chgFile + ' is deleted successfully');
								}
							});
							fs.unlink(thmFile, function(err){
								if(err) {
									logger.error(err);
								}else{
									logger.info(thmFile + ' is deleted successfully');
								}
							});
							*/
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateEventContents(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p['content-length'] > 0){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var post = qs.parse(data.toString());
					var param = [
						post.event_id, 
						post.title, 
						post.contents 
					];
					var paramCheck = true;
					param.forEach(function(d, idx){
						if(d) {
						}else{
							paramCheck = false;
						}
					});
					var classId = post.class_id ? post.class_id : -1;
					var address = post.address ? post.address : '';
					var date = post.date ? post.date : '';
					param = [post.event_id, classId, post.title, post.contents, post.address, date];
					logger.info(param);
					if(paramCheck){
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL updateEventContents(?,?,?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result > 0){
											sendResponse(req, res, json);
										}else{
											json = {status:'-99',message:'System Error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteEvent(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id){
		var param = [p.event_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteEvent(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteEventReply(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id && p.reply_id){
		var param = [p.event_id, p.reply_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteEventReply(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function sendEventRead(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id && p.member_id){
		var param = [p.event_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL sendEventRead(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doEventReadOver(pool, p.event_id);
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function plusEventGoodCnt(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id && p.member_id){
		var param = [p.event_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL plusEventGoodCnt(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMngClassList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMngClassList(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var class_cnt = result[0].length;
							json['class_cnt'] = class_cnt;
							var classObj = [];
							result[0].forEach(function(d, idx){
								classObj.push({
									id: d.id + '',
									name: d.name,
									desc: d.desc,
									approved_cnt: d.approved_cnt,
									nonapproved_cnt: d.nonapproved_cnt
								});
							});
							json['class'] = classObj;
						}else{
							json['class_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postClassInfo(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.class_name && p.class_desc){
				var param = [p.center_id, p.class_name, p.class_desc];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postClassInfo(?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-82',message:'post class info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function updateClassInfo(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.class_id && p.class_name && p.class_desc){
				var param = [p.class_id, p.class_name, p.class_desc];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL updateClassInfo(?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-81',message:'update class info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function setMessageTime(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.set_yn && p.s_hour && p.s_min && p.e_hour && p.e_min){
				var param = [p.center_id, p.set_yn, p.s_hour, p.s_min, p.e_hour, p.e_min];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL setMessageTime(?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-81',message:'update class info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function deleteClassInfo(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.class_id){
		var param = [p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteClassInfo(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMemberInfo(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id){
		var param = [p.member_id];
		logger.info(param)
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMemberInfo(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs){
							json['member'] = { 
								type: rs.member_type + '',
								center_id: rs.center_id + '',
								center_type: rs.center_type + '',
								center_name: rs.center_name + '',
								invitation_code: rs.invitation_code,
								country_id: rs.country_id + '',
								country_name: rs.country_name + '',
								state_id: rs.state_id + '',
								state_name: rs.state_name + '',
								city_id: rs.city_id + '',
								city_name: rs.city_name + '',
								name: rs.member_name,
								phonenum: rs.phonenum,
								img: rs.img,
								class_id: rs.class_id + '',
								class_name: rs.class_name
							};
						}else{
							json = {status:'-13',message:'not found member'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateMemberType2Info(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_id, 
				post.member_name, 
				post.phonenum,
				post.center_id 
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			var classId = post.class_id == '' ? 0 : post.class_id;
			param.push(classId);
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.member_id + '_' + post.filename) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											logger.info(dFileThm + ' 1 - w:'+w+', h:'+h);
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL updateMemberType2Info(?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																if(rs.push_flag == '1'){
																	push.doApproveManagerList(pool, post.member_id, -1, '0');
																}
															}else{
																json = {status:'-80',message:'updateMemberType2Info error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL updateMemberType2Info(?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, post.member_id, -1, '0');
									}else{
										json = {status:'-80',message:'updateMemberType2Info error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function updateMemberType2Info_121(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_id, 
				post.member_name, 
				post.phonenum,
				post.center_id,
				post.class_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.member_id + '_' + post.filename) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											logger.info(dFileThm + ' 1 - w:'+w+', h:'+h);
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL updateMemberType2Info_121(?,?,?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
																if(rs.push_flag == '1'){
																	push.doApproveManagerList(pool, post.member_id, -1, '0');
																}
															}else{
																json = {status:'-80',message:'updateMemberType2Info_121 error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL updateMemberType2Info_121(?,?,?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
										push.doApproveManagerList(pool, post.member_id, -1, '0');
									}else{
										json = {status:'-80',message:'updateMemberType2Info_121 error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function updateMemberType1Info(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = config.memberDir + '/' + config.orgDir + '/';
	var middleThmDir = config.memberDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.member_id, 
				post.member_name, 
				post.phonenum
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck){
				if(post.filename && post.image){
					if(config.regexpImageFileExt.test(post.filename)){
						var filename = util.sha1(post.member_id + '_' + post.filename) + '.' + util.getFileNameExt(post.filename);
						var fileFullPath = config.mainImagePath + middleOrgDir + filename;
						fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
							if(err){
								json = {status:'-91',message:'File System Error(image creation)'};
								sendResponse(req, res, json);
							}else{
								imagic(fileFullPath).size(function (err, size) {
									var dFileThm = null;
									var w = size.width;
									var h = size.height;
									if(err){
										logger.error(err);
										json = {status:'-95',message:'File System Error(check image size)'};
										sendResponse(req, res, json);
										fs.unlink(fileFullPath, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(fileFullPath + ' is deleted successfully');
											}
										});
										return;
									}else{
										if(size && size.width){
											dFileThm = config.mainImagePath + middleThmDir + filename;
											logger.info(dFileThm + ' 1 - w:'+w+', h:'+h);
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmProfileWidth){
													finalW = config.thmProfileWidth;
													finalH = config.thmProfileWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											w = Math.round(finalW);
											h = Math.round(finalH);
										}else{
											logger.error('image file size check error!');
											json = {status:'-95',message:'File System Error(check image size)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
											return;
										}
									}
									imagic(fileFullPath).resize(w,h).noProfile().quality(config.imageQuality).write(dFileThm, function(err){ 
										if(err){
											logger.error(err);
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											fs.unlink(fileFullPath, function(err){
												if(err) {
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is deleted successfully');
												}
											});
										}else{
											logger.info(dFileThm + ' - done');
											param.push(filename);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													conn.query('CALL updateMemberType1Info(?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result){
																sendResponse(req, res, json);
															}else{
																json = {status:'-79',message:'updateMemberType1Info error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});//end of db pool
										}
									});
								});
							}
						});//end of image file write
					}else{
						json = {status:'-12',message:'image file format invalid'};
						sendResponse(req, res, json);
					}
				}else{
					param.push('');
					pool.getConnection(function(err, conn){
						if(err){
							logger.error(err.message);
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}else{
							conn.query('CALL updateMemberType1Info(?,?,?,?)',param, function(err, result){
								conn.release();
								if(err){
									logger.error(err.message);
									json = {status:'-99',message:'System Error'};
									sendResponse(req, res, json);
								}else{
									var rs = result[0][0];
									logger.info(rs);
									if(rs.result){
										sendResponse(req, res, json);
									}else{
										json = {status:'-79',message:'updateMemberType1Info error'};
										sendResponse(req, res, json);
									}
								}
							});
						}
					});//end of db pool
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
			json = {status:'-2',message:'parameter invalid'};
			sendResponse(req, res, json);
		}
	});//req.on('end');
}

function updateMemberType3Info(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.member_id && p.member_name && p.phonenum){
				var param = [p.member_id, p.member_name, p.phonenum];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL updateMemberType3Info(?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								if(rs.result){
									sendResponse(req, res, json);
								}else{
									json = {status:'-81',message:'updateMemberType3Info error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function postMamaTalkContents(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.class_id && p.member_id && p.title && p.contents){
				var param = [p.center_id, p.class_id, p.member_id, p.title, p.contents];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postMamaTalkContents(?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.mamatalk_id){
									json['mamatalk_id'] = rs.mamatalk_id + '';
									sendResponse(req, res, json);
								}else{
									json = {status:'-78',message:'post mamatalk contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function postMamaTalkContents2(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.class_id && p.member_id && p.kids_id && p.title && p.contents){
				var param = [p.center_id, p.class_id, p.member_id, p.kids_id, p.title, p.contents];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postMamaTalkContents2(?,?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.mamatalk_id){
									json['mamatalk_id'] = rs.mamatalk_id + '';
									sendResponse(req, res, json);
								}else{
									json = {status:'-78',message:'post mamatalk contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function postMamaTalkImage(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id){
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = 'c' + p.center_id + '/' + config.mamatalkDir + '/' + config.orgDir + '/';
	var middleChgDir = 'c' + p.center_id + '/' + config.mamatalkDir + '/' + config.chgDir + '/';
	var middleThmDir = 'c' + p.center_id + '/' + config.mamatalkDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleChgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);	

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.mamatalk_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck && post.filename && post.image){
				if(config.regexpImageFileExt.test(post.filename)){
					var filename = util.sha1(post.center_id + '' + post.filename + '' + Date.now()) + '.' + util.getFileNameExt(post.filename);
					param.push(filename);
					var fileFullPath = config.mainImagePath + middleOrgDir + filename;
					fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
						if(err){
							json = {status:'-91',message:'File System Error(image creation)'};
							sendResponse(req, res, json);
						}else{
							var tasks = [];
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileChg = config.mainImagePath + middleChgDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH), sizeSave:true});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH), sizeSave:false});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							logger.info('*** tasks.length:'+tasks.length);
							async.series(tasks, function(err, results){
								if(err){
									json = {status:'-95',message:'File System Error(check image size)'};
									sendResponse(req, res, json);
									logger.error(err);
									results.forEach(function(o, idx){
										fs.unlink(o.sFile, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(o.sFile + ' is deleted successfully');
											}
										});
									});
								}else{
									var works = [];
									results.forEach(function(o, idx){
										works.push(function(callback){
											imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
												callback(err, o);
											});
										});
									});
									logger.info('*** works.length:'+works.length);
									async.series(works, function(err, results){
										if(err){
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											logger.error(err);
											results.forEach(function(o, idx){
												fs.unlink(o.sFile, function(err){
													if(err) {
														logger.error(err);
													}else{
														logger.info(o.sFile + ' is deleted successfully');
													}
												});
											});
										}else{
											var imageW = 0;
											var imageH = 0;
											results.forEach(function(o, idx){
												if(o.sizeSave){
													imageW = o.w;
													imageH = o.h;
												}
												logger.info(o.dFile + ' is done');
											});
											imagic(fileFullPath).quality(config.imageQuality).write(fileFullPath, function(err){
												if(err){
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is done(quality)');
												}
											});
											param.push(imageW);
											param.push(imageH);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info('*** call procedure before param:'+param);
													conn.query('CALL postMamaTalkImage(?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result > 0){
																sendResponse(req, res, json);
															}else{
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});
										}
									});
								}
							});
						}
					});//end of image file write
				}else{
					json = {status:'-12',message:'image file format invalid'};
					sendResponse(req, res, json);
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
		}
	});//req.on('end');
}

function getMamaTalkList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.pageno && p.pagesize){
		var param = [p.center_id];
		if(p.class_id){
			param.push(p.class_id);
		}else{
			param.push(-1);
		}
		param.push(p.pageno);
		param.push(p.pagesize);
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getMamaTalkList(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var mamatalk_cnt = result[0].length;
							json['mamatalk_cnt'] = mamatalk_cnt;
							var mamatalk = [];
							result[0].forEach(function(d, idx){
								var mamatalkTmp = {
									id: d.mamatalk_id + '',
									title: d.title, 
									contents: d.contents,
									goodcnt: d.goodcnt,
									createtime: d.createtime,
									writer: {
										id: d.writer_id + '',
										type: d.writer_type,
										name: d.writer_name,
										img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
									},
									reply_cnt: d.reply_cnt,
								};
								if(d.img1 != ''){
									mamatalkTmp['img1'] = {
										url: config.http.url + '' + d.img1,
										w: d.img1w,
										h: d.img1h
									};
								}
								if(d.img2 != ''){
									mamatalkTmp['img2'] = {
										url: config.http.url + '' + d.img2,
										w: d.img2w,
										h: d.img2h
									};
								}
								if(d.img3 != ''){
									mamatalkTmp['img3'] = {
										url: config.http.url + '' + d.img3,
										w: d.img3w,
										h: d.img3h
									};
								}
								if(d.img4 != ''){
									mamatalkTmp['img4'] = {
										url: config.http.url + '' + d.img4,
										w: d.img4w,
										h: d.img4h
									};
								}
								if(d.img5 != ''){
									mamatalkTmp['img5'] = {
										url: config.http.url + '' + d.img5,
										w: d.img5w,
										h: d.img5h
									};
								}
								if(d.img6 != ''){
									mamatalkTmp['img6'] = {
										url: config.http.url + '' + d.img6,
										w: d.img6w,
										h: d.img6h
									};
								}
								if(d.img7 != ''){
									mamatalkTmp['img7'] = {
										url: config.http.url + '' + d.img7,
										w: d.img7w,
										h: d.img7h
									};
								}
								if(d.img8 != ''){
									mamatalkTmp['img8'] = {
										url: config.http.url + '' + d.img8,
										w: d.img8w,
										h: d.img8h
									};
								}
								if(d.img9 != ''){
									mamatalkTmp['img9'] = {
										url: config.http.url + '' + d.img9,
										w: d.img9w,
										h: d.img9h
									};
								}
								if(d.img10 != ''){
									mamatalkTmp['img10'] = {
										url: config.http.url + '' + d.img10,
										w: d.img10w,
										h: d.img10h
									};
								}
								mamatalk.push(mamatalkTmp);
								if(d.class_id){
							    mamatalk[idx]['class'] = {
										id: d.class_id,
										name: d.class_name
									}		
								}else{
									mamatalk[idx]['class'] = {
										id: '',
										name: '' 
									}
								}
							});
							json['mamatalk'] = mamatalk;
						}else{
							json['mamatalk_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateDeviceToken(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.member_id && p.device_type && p.device_token && p.locale){
				var param = [p.member_id, p.device_type, p.device_token, p.locale];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL updateDeviceToken(?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.result){
									json['device_id'] = rs.id + '';
									sendResponse(req, res, json);
								}else{
									json = {status:'-77',message:'update deviceToken error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function deleteMamaTalkImage(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id && p.filename){
		var param = [p.mamatalk_id, p.filename];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteMamaTalkImage(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result > 0){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postMamaTalkReply(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.mamatalk_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var param = [p.mamatalk_id, p.member_id, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postMamaTalkReply(?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doMamaTalkReplyAdd(pool, p.mamatalk_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-76',message:'post mamatalk reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postMamaTalkReply2(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.mamatalk_id && p.member_id && p.kids_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var param = [p.mamatalk_id, p.member_id, p.kids_id, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postMamaTalkReply2(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.reply_id){
											push.doMamaTalkReplyAdd(pool, p.mamatalk_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-76',message:'post mamatalk reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteMamaTalkReply(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id && p.reply_id){
		var param = [p.mamatalk_id, p.reply_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteMamaTalkReply(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMamaTalkReplyList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id && p.pageno && p.pagesize){
		var param = [p.mamatalk_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMamaTalkReplyList(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									mamatalk_id: d.mamatalk_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMamaTalkReplyList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id && p.pageno && p.pagesize){
		var param = [p.mamatalk_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMamaTalkReplyList2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									mamatalk_id: d.mamatalk_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateMamaTalkContents(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p['content-length'] > 0){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var post = qs.parse(data.toString());
					var param = [
						post.mamatalk_id, 
						post.title, 
						post.contents 
					];
					var paramCheck = true;
					param.forEach(function(d, idx){
						if(d) {
						}else{
							paramCheck = false;
						}
					});
					var classId = post.class_id ? post.class_id : -1;
					param = [post.mamatalk_id, classId, post.title, post.contents];
					logger.info(param);
					if(paramCheck){
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL updateMamaTalkContents(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result > 0){
											sendResponse(req, res, json);
										}else{
											json = {status:'-99',message:'System Error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteMamaTalk(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id){
		var param = [p.mamatalk_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteMamaTalk(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function plusMamaTalkGoodCnt(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id && p.member_id){
		var param = [p.mamatalk_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL plusMamaTalkGoodCnt(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == -1){
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMamaTalkDetail(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.mamatalk_id){
		var param = [p.mamatalk_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getMamaTalkDetail(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var d = result[0][0];
						if(d){
							json['mamatalk_cnt'] = 1;
							var mamatalk = [];
							var mamatalkTmp = {
								id: d.mamatalk_id + '',
								title: d.title, 
								contents: d.contents,
								goodcnt: d.goodcnt,
								createtime: d.createtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							if(d.img1 != ''){
								mamatalkTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								mamatalkTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								mamatalkTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								mamatalkTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								mamatalkTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								mamatalkTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								mamatalkTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								mamatalkTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								mamatalkTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								mamatalkTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								mamatalkTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								mamatalkTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							mamatalk.push(mamatalkTmp);
							json['mamatalk'] = mamatalk;
						}else{
							json['mamatalk_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function setPushReceiveYn(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.push_key && p.push_value){
		var param = [p.member_id, p.push_key, p.push_value];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL setPushReceiveYn(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getPushReceiveYnList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id){
		var param = [p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getPushReceiveYnList(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							result[0].forEach(function(d, idx){
								json['contact'] = d.contact;
								json['notice'] = d.notice;
								json['event'] = d.event;
								json['dailymenu'] = d.dailymenu;
								json['reply'] = d.reply;
								json['attendance'] = d.attendance;
								json['confirm'] = d.confirm;
							});
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMessageTime(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMessageTime(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							result[0].forEach(function(d, idx){
								json['set_yn'] = d.message_time_set_yn;
								json['s_hour'] = d.message_time_s_hour;
								json['s_min'] = d.message_time_s_min;
								json['e_hour'] = d.message_time_e_hour;
								json['e_min'] = d.message_time_e_min;
							});
						}else{
							json = {status:'-14',message:'not found information'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function pushNotReadNoticeMemberList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.notice_id){
		sendResponse(req, res, json);
		push.doNotReadNoticeMemberList(pool, p.notice_id);
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function pushNotReadEventMemberList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.event_id){
		sendResponse(req, res, json);
		push.doNotReadEventMemberList(pool, p.event_id);
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getCenterTypeList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.country_id){
		var param = [p.country_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getCenterTypeList(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['centertype_cnt'] = result[0].length;
							var centertype = [];
							result[0].forEach(function(d, idx){
								centertype.push({
									type: d.type + '',
									name: d.name,
									desc: d.desc
								});
							});
							json['centertype'] = centertype;
						}else{
							json['centertype_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postContactContents(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.member_id && p.contents){
				var param = [p.center_id, p.member_id, p.contents, p.to_kids_id];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postContactContents(?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.contact_id){
									json['contact_id'] = rs.contact_id + '';
									push.doContactTargetList(pool, rs.contact_id);
									sendResponse(req, res, json);
								}else{
									json = {status:'-75',message:'post contact contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function postContactContents2(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.member_id && p.contents){
				var kidsId = p.kids_id ? p.kids_id : -1;
				var param = [p.center_id, p.member_id, kidsId, p.contents, p.to_kids_id];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL postContactContents2(?,?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.contact_id){
									json['contact_id'] = rs.contact_id + '';
									push.doContactTargetList(pool, rs.contact_id);
									sendResponse(req, res, json);
								}else{
									json = {status:'-75',message:'post contact contents error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function postContactImage(req, res){
	var json = {status:'OK',message:''};
	logger.info(req.headers);
	var p = req.headers;
	if(p['content-length'] > config.userContentMaxSize){
		req.removeListener('data', function(){
		});
		logger.info('File too large');
		json = {status:'-3',message:'File Size too large'};
		sendResponse(req, res, json);
		return;
	}
	if(p.center_id){
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
		return;
	}
	var middleOrgDir = 'c' + p.center_id + '/' + config.contactDir + '/' + config.orgDir + '/';
	var middleChgDir = 'c' + p.center_id + '/' + config.contactDir + '/' + config.chgDir + '/';
	var middleThmDir = 'c' + p.center_id + '/' + config.contactDir + '/' + config.thmDir + '/';
	util.mkdirParent(config.mainImagePath + '' + middleOrgDir);
	util.mkdirParent(config.mainImagePath + '' + middleChgDir);
	util.mkdirParent(config.mainImagePath + '' + middleThmDir);	

	var bufs = [];
	bufs.totalLength = 0;
	req.on('data', function(chunk){
		if(chunk){
			bufs.push(chunk);
			bufs.totalLength += chunk.length;
		}
	});
	req.on('end', function(){
		logger.info('bufs.totalLength:'+bufs.totalLength);
		if(bufs.totalLength > 0){
			var data = Buffer.concat(bufs, bufs.totalLength);
			var post = qs.parse(data.toString());
			var param = [
				post.contact_id
			];
			var paramCheck = true;
			param.forEach(function(d, idx){
				if(d) {
				}else{
					paramCheck = false;
				}
			});
			logger.info(param);
			logger.info('filename:'+post.filename);
			if(paramCheck && post.filename && post.image){
				if(config.regexpImageFileExt.test(post.filename)){
					var filename = util.sha1(post.center_id + '' + post.filename + '' + Date.now()) + '.' + util.getFileNameExt(post.filename);
					param.push(filename);
					var fileFullPath = config.mainImagePath + middleOrgDir + filename;
					fs.writeFile(fileFullPath, new Buffer(post.image.replace(/\s/g,'+'), 'base64'), function(err){
						if(err){
							json = {status:'-91',message:'File System Error(image creation)'};
							sendResponse(req, res, json);
						}else{
							var tasks = [];
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileChg = config.mainImagePath + middleChgDir + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.chgWidth){
													finalW = config.chgWidth;
													finalH = config.chgWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileChg, w:Math.round(finalW), h:Math.round(finalH), sizeSave:true});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							tasks.push(function(next){
								imagic(fileFullPath).size(function (err, size) {
									if(err){
										next(err, {sFile: fileFullPath});
									}else{
										if(size && size.width){
											var w = size.width;
											var h = size.height;
											var sFile = fileFullPath;
											var dFileThm = config.mainImagePath + middleThmDir + 'thm_' + filename;
											var finalW, finalH;
											if(h >= w){
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}else{
												if(w >= config.thmWidth){
													finalW = config.thmWidth;
													finalH = config.thmWidth * h / w;
												}else{
													finalW = w;
													finalH = h;
												}
											}
											next(null, {sFile:sFile, dFile:dFileThm, w:Math.round(finalW), h:Math.round(finalH), sizeSave:false});
										}else{
											next(new Error('image file size check error!'), {sFile: fileFullPath});
										}
									}
								});
							});
							logger.info('*** tasks.length:'+tasks.length);
							async.series(tasks, function(err, results){
								if(err){
									json = {status:'-95',message:'File System Error(check image size)'};
									sendResponse(req, res, json);
									logger.error(err);
									results.forEach(function(o, idx){
										fs.unlink(o.sFile, function(err){
											if(err) {
												logger.error(err);
											}else{
												logger.info(o.sFile + ' is deleted successfully');
											}
										});
									});
								}else{
									var works = [];
									results.forEach(function(o, idx){
										works.push(function(callback){
											imagic(o.sFile).resize(o.w,o.h).noProfile().quality(config.imageQuality).write(o.dFile, function(err){ 
												callback(err, o);
											});
										});
									});
									logger.info('*** works.length:'+works.length);
									async.series(works, function(err, results){
										if(err){
											json = {status:'-94',message:'File System Error(image resize and copy)'};
											sendResponse(req, res, json);
											logger.error(err);
											results.forEach(function(o, idx){
												fs.unlink(o.sFile, function(err){
													if(err) {
														logger.error(err);
													}else{
														logger.info(o.sFile + ' is deleted successfully');
													}
												});
											});
										}else{
											var imageW = 0;
											var imageH = 0;
											results.forEach(function(o, idx){
												if(o.sizeSave){
													imageW = o.w;
													imageH = o.h;
												}
												logger.info(o.dFile + ' is done');
											});
											imagic(fileFullPath).quality(config.imageQuality).write(fileFullPath, function(err){
												if(err){
													logger.error(err);
												}else{
													logger.info(fileFullPath + ' is done(quality)');
												}
											});
											param.push(imageW);
											param.push(imageH);
											pool.getConnection(function(err, conn){
												if(err){
													logger.error(err.message);
													json = {status:'-99',message:'System Error'};
													sendResponse(req, res, json);
												}else{
													logger.info('*** call procedure before param:'+param);
													conn.query('CALL postContactImage(?,?,?,?)',param, function(err, result){
														conn.release();
														if(err){
															logger.error(err.message);
															json = {status:'-99',message:'System Error'};
															sendResponse(req, res, json);
														}else{
															var rs = result[0][0];
															logger.info(rs);
															if(rs.result > 0){
																sendResponse(req, res, json);
															}else{
																json = {status:'-99',message:'System Error'};
																sendResponse(req, res, json);
															}
														}
													});
												}
											});
										}
									});
								}
							});
						}
					});//end of image file write
				}else{
					json = {status:'-12',message:'image file format invalid'};
					sendResponse(req, res, json);
				}
			}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		}else{
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
		}
	});//req.on('end');
}

function getContactList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.month && p.member_id && p.pageno && p.pagesize){
		var param = [p.center_id, p.month, p.member_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getContactList(?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['contact_cnt'] = result[0].length;
							var contact = [];
							result[0].forEach(function(d, idx){
								var contactTmp = {
									id: d.contact_id + '',
									date: d.date,
									type: d.contact_type,
									contents: d.contents,
									status: d.status + '',
									createtime: d.createtime,
									readyn: d.readyn,
									readtime: d.readtime,
									writer: {
										id: d.writer_id + '',
										type: d.writer_type,
										name: d.writer_name,
										img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
									},
									reply_cnt: d.reply_cnt
								};
								var targetTotalCnt = 0;
								var targetReadCnt = 0;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								contactTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
								if(d.img1 != ''){
									contactTmp['img1'] = {
										url: config.http.url + '' + d.img1,
										w: d.img1w,
										h: d.img1h
									};
								}
								if(d.img2 != ''){
									contactTmp['img2'] = {
										url: config.http.url + '' + d.img2,
										w: d.img2w,
										h: d.img2h
									};
								}
								if(d.img3 != ''){
									contactTmp['img3'] = {
										url: config.http.url + '' + d.img3,
										w: d.img3w,
										h: d.img3h
									};
								}
								if(d.img4 != ''){
									contactTmp['img4'] = {
										url: config.http.url + '' + d.img4,
										w: d.img4w,
										h: d.img4h
									};
								}
								if(d.img5 != ''){
									contactTmp['img5'] = {
										url: config.http.url + '' + d.img5,
										w: d.img5w,
										h: d.img5h
									};
								}
								if(d.img6 != ''){
									contactTmp['img6'] = {
										url: config.http.url + '' + d.img6,
										w: d.img6w,
										h: d.img6h
									};
								}
								if(d.img7 != ''){
									contactTmp['img7'] = {
										url: config.http.url + '' + d.img7,
										w: d.img7w,
										h: d.img7h
									};
								}
								if(d.img8 != ''){
									contactTmp['img8'] = {
										url: config.http.url + '' + d.img8,
										w: d.img8w,
										h: d.img8h
									};
								}
								if(d.img9 != ''){
									contactTmp['img9'] = {
										url: config.http.url + '' + d.img9,
										w: d.img9w,
										h: d.img9h
									};
								}
								if(d.img10 != ''){
									contactTmp['img10'] = {
										url: config.http.url + '' + d.img10,
										w: d.img10w,
										h: d.img10h
									};
								}
								contact.push(contactTmp);
								if(d.class_id){
							    contact[idx]['class'] = {
										id: d.class_id,
										name: d.class_name
									}		
								}else{
									contact[idx]['class'] = {
										id: '',
										name: '' 
									}
								}
							});
							json['contact'] = contact;
						}else{
							json['contact_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getContactList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.month && p.member_id && p.pageno && p.pagesize){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.center_id, p.month, p.member_id, kidsId, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getContactList2(?,?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['contact_cnt'] = result[0].length;
							var contact = [];
							result[0].forEach(function(d, idx){
								var contactTmp = {
									id: d.contact_id + '',
									date: d.date,
									type: d.contact_type,
									contents: d.contents,
									status: d.status + '',
									createtime: d.createtime,
									readyn: d.readyn,
									readtime: d.readtime,
									writer: {
										id: d.writer_id + '',
										type: d.writer_type,
										name: d.writer_name,
										img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
									},
									reply_cnt: d.reply_cnt
								};
								var targetTotalCnt = 0;
								var targetReadCnt = 0;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								contactTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
								if(d.img1 != ''){
									contactTmp['img1'] = {
										url: config.http.url + '' + d.img1,
										w: d.img1w,
										h: d.img1h
									};
								}
								if(d.img2 != ''){
									contactTmp['img2'] = {
										url: config.http.url + '' + d.img2,
										w: d.img2w,
										h: d.img2h
									};
								}
								if(d.img3 != ''){
									contactTmp['img3'] = {
										url: config.http.url + '' + d.img3,
										w: d.img3w,
										h: d.img3h
									};
								}
								if(d.img4 != ''){
									contactTmp['img4'] = {
										url: config.http.url + '' + d.img4,
										w: d.img4w,
										h: d.img4h
									};
								}
								if(d.img5 != ''){
									contactTmp['img5'] = {
										url: config.http.url + '' + d.img5,
										w: d.img5w,
										h: d.img5h
									};
								}
								if(d.img6 != ''){
									contactTmp['img6'] = {
										url: config.http.url + '' + d.img6,
										w: d.img6w,
										h: d.img6h
									};
								}
								if(d.img7 != ''){
									contactTmp['img7'] = {
										url: config.http.url + '' + d.img7,
										w: d.img7w,
										h: d.img7h
									};
								}
								if(d.img8 != ''){
									contactTmp['img8'] = {
										url: config.http.url + '' + d.img8,
										w: d.img8w,
										h: d.img8h
									};
								}
								if(d.img9 != ''){
									contactTmp['img9'] = {
										url: config.http.url + '' + d.img9,
										w: d.img9w,
										h: d.img9h
									};
								}
								if(d.img10 != ''){
									contactTmp['img10'] = {
										url: config.http.url + '' + d.img10,
										w: d.img10w,
										h: d.img10h
									};
								}
								contact.push(contactTmp);
								if(d.class_id){
							    contact[idx]['class'] = {
										id: d.class_id,
										name: d.class_name
									}		
								}else{
									contact[idx]['class'] = {
										id: '',
										name: '' 
									}
								}
							});
							json['contact'] = contact;
						}else{
							json['contact_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteContactImage(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.filename){
		var param = [p.contact_id, p.filename];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteContactImage(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result > 0){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postContactReply(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.contact_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var param = [p.contact_id, p.member_id, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postContactReply(?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result){
											push.doContactReplyAdd(pool, p.contact_id, p.member_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-74',message:'post contact reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function postContactReply2(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p.contact_id && p.member_id){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var contents = data.toString();
					if(contents){
						var kidsId = p.kids_id ? p.kids_id : -1;
						var param = [p.contact_id, p.member_id, kidsId, contents];
						logger.info(param);
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL postContactReply2(?,?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result){
											push.doContactReplyAdd(pool, p.contact_id, p.member_id);
											sendResponse(req, res, json);
										}else{
											json = {status:'-74',message:'post contact reply error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getContactReplyList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.member_id && p.pageno && p.pagesize){
		var param = [p.contact_id, p.member_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getContactReplyList(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									contact_id: d.contact_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getContactReplyList2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.member_id && p.pageno && p.pagesize){
		var param = [p.contact_id, p.member_id, p.pageno, p.pagesize];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getContactReplyList2(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var reply_cnt = result[0].length;
							json['reply_cnt'] = reply_cnt;
							var reply = [];
							result[0].forEach(function(d, idx){
								reply.push({
									contact_id: d.contact_id + '',
									reply_id: d.reply_id + '',
									member_id: d.id + '',
									member_type: d.type + '',
									member_name: d.name,
									member_img: d.img == '' ? '' : config.http.url + '' + d.img,
									contents: d.contents,
									createtime: d.createtime,
								});
							});
							json['reply'] = reply;
						}else{
							json['reply_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteContactReply(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.reply_id){
		var param = [p.contact_id, p.reply_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteContactReply(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function updateContactContents(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p['content-length'] > 0){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var post = qs.parse(data.toString());
					var param = [
						post.contact_id, 
						post.contents 
					];
					var paramCheck = true;
					param.forEach(function(d, idx){
						if(d) {
						}else{
							paramCheck = false;
						}
					});
					param = [post.contact_id, post.contents];
					logger.info(param);
					if(paramCheck){
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL updateContactContents(?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result > 0){
											sendResponse(req, res, json);
										}else{
											json = {status:'-99',message:'System Error'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteContact(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id){
		var param = [p.contact_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteContact(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function sendContactRead(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.member_id){
		var param = [p.contact_id, p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL sendContactRead(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doContactReadOver(pool, p.contact_id, p.member_id);
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function sendContactRead2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id && p.member_id){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.contact_id, p.member_id, kidsId];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL sendContactRead2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doContactReadOver(pool, p.contact_id, p.member_id);
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getMemberListNotReadContact(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id){
		var param = [p.contact_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getMemberListNotReadContact(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var member_cnt = result[0].length;
							json['member_cnt'] = member_cnt;
							var member = [];
							result[0].forEach(function(d, idx){
								var obj = {
									member_id: d.member_id + '',
									type: d.type,
									member_name: d.member_name,
									phonenum: d.phonenum,
									email: d.email,
									member_img: d.member_img == '' ? '' : config.http.url + '' + d.member_img,
									kids_id: d.kids_id,
									kids_name: d.kids_name,
									kids_sex: d.kids_sex,
									kids_img: d.kids_img == '' ? '' : config.http.url + '' + d.kids_img,
									class_name: d.class_name,
									readyn: d.readyn
								};
								member.push(obj);
							});
							json['member'] = member;
						}else{
							json['member_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function pushNotReadContactMemberList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.contact_id){
		sendResponse(req, res, json);
		push.doNotReadContactMemberList(pool, p.contact_id);
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getKidsList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.class_id){
		var param = [p.center_id, p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getKidsList(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['kids_cnt'] = result[0].length;
							var kids = [];
							result[0].forEach(function(d, idx){
								var obj = {
									id: d.id,
									name: d.name,
									class_id: d.class_id + '',
									sex: d.sex,
									img: d.img == '' ? '' : config.http.url + '' + d.img,
									birthday: d.birthday
								};
								kids.push(obj);
							});
							json['kids'] = kids;
						}else{
							json['kids_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function checkAttendance(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_id && p.date && p.class_id && p.kids_id_str){
				var param = [p.center_id, p.date, p.class_id, p.kids_id_str];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL checkAttendance(?,?,?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								var rs = result[0][0];
								logger.info(rs);
								if(rs.result){
									sendResponse(req, res, json);
									push.doAttendanceCheckMemberList(pool, p.center_id, p.class_id, p.kids_id_str);
								}else{
									json = {status:'-73',message:'checkAttendance error'};
									sendResponse(req, res, json);
								}
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}

function getAttendanceInfo(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.date && p.class_id){
		var param = [p.center_id, p.date, p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getAttendanceInfo(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['kids_cnt'] = result[0].length;
							var kids = [];
							result[0].forEach(function(d, idx){
								var obj = {
									id: d.id,
									name: d.name,
									sex: d.sex,
									img: d.img == '' ? '' : config.http.url + '' + d.img,
									birthday: d.birthday,
									attendance: d.attendance + ''
								};
								kids.push(obj);
							});
							json['kids'] = kids;
						}else{
							json['kids_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function changeKidsClass(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.kids_id && p.class_id){
		var param = [p.kids_id, p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL changeKidsClass(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function voidKidsApproval(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.kids_id){
		var param = [p.kids_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL voidKidsApproval(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getVersions(req, res) {
	var p = url.parse(req.url, true).query;
	var json = {status:'OK',message:''};
	var param = [];
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
			json = {status:'-99',message:'System Error'};
			sendResponse(req, res, json);
		}else{
			conn.query('CALL getVersions()',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
					json = {status:'-99',message:'System Error'};
					sendResponse(req, res, json);
				}else{
					if(result[0]){
						json['platform_cnt'] = result[0].length;
						var platform = [];
						result[0].forEach(function(d, idx){
							var obj = {
								os: d.os,
								version: d.version,
								url: d.url,
								package: d.package
							};
							platform.push(obj);
						});
						json['platform'] = platform;
					}else{
						json['platform_cnt'] = 0;
					}
					sendResponse(req, res, json);
				}
			});
		}
	});
}

function changeTeacherClass(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.class_id){
		var param = [p.member_id, p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL changeTeacherClass(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function changeTeacherClass_121(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.class_id){
		var param = [p.member_id, p.class_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL changeTeacherClass_121(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getTeacherList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getTeacherList(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['teacher_cnt'] = result[0].length;
							var teachers = [];
							result[0].forEach(function(d, idx){
								var obj = {
									id: d.id + '',
									name: d.name,
									phonenum: d.phonenum,
									img: d.img == '' ? '' : config.http.url + '' + d.img,
									class_id: d.class_id + '',
									class_name: d.class_name,
									approval_state: d.approval_state + ''
								};
								teachers.push(obj);
							});
							json['teachers'] = teachers;
						}else{
							json['teacher_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getTeacherList_121(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getTeacherList_121(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['teacher_cnt'] = result[0].length;
							var teachers = [];
							result[0].forEach(function(d, idx){
								var obj = {
									id: d.id + '',
									name: d.name,
									phonenum: d.phonenum,
									img: d.img == '' ? '' : config.http.url + '' + d.img,
									approval_state: d.approval_state + ''
								};
								var classInfo = d.class_info;
								var classArr = classInfo.split('::');
								obj['class_cnt'] = classArr.length;
								var classes = [];
								for(var i=0;i<classArr.length;i++){
									var cls = classArr[i].split('||');
									var clsObj = {
										'id': cls[0],
										'name': cls[1]
									};
									classes.push(clsObj);
								}
								obj['class'] = classes;
								teachers.push(obj);
							});
							json['teachers'] = teachers;
						}else{
							json['teacher_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function voidTeacherApproval(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id){
		var param = [p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL voidTeacherApproval(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function setInvitationCode(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id && p.invitation_code){
		var param = [p.center_id, p.invitation_code];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL setInvitationCode(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getInvitationCode(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getInvitationCode(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						if(rs.invitation_code){
							json['invitation_code'] = rs.invitation_code;
						}else{
							json['invitation_code'] = '';
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getBadge(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id){
		var param = [p.member_id, p.device_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getBadge(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs && rs.id){
							json['badge'] = {
								news: rs.news + '',
								manage: rs.manage + '',
								contact: rs.contact + '',
								notice: rs.notice + '',
								event: rs.event + '',
								dailymenu: rs.dailymenu + '',
								mamatalk: rs.mamatalk + '',
							}
						}else{
							json['badge'] = {
								news: '0',
								manage: '0',
								contact: '0',
								notice: '0',
								event: '0',
								dailymenu: '0',
								mamatalk: '0',
							}
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getBadge2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.member_id, p.device_id, kidsId];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getBadge2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs && rs.id){
							json['badge'] = {
								news: rs.news + '',
								manage: rs.manage + '',
								contact: rs.contact + '',
								notice: rs.notice + '',
								event: rs.event + '',
								dailymenu: rs.dailymenu + '',
								mamatalk: rs.mamatalk + '',
							}
						}else{
							json['badge'] = {
								news: '0',
								manage: '0',
								contact: '0',
								notice: '0',
								event: '0',
								dailymenu: '0',
								mamatalk: '0',
							}
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function setBadge(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.badge_name){
		var param = [p.member_id, p.badge_name];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL setBadge(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function setBadge2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.badge_name){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.member_id, p.badge_name, kidsId];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL setBadge2(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function setLocale(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id && p.locale){
		var param = [p.member_id, p.device_id, p.locale];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL setLocale(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function chgPw(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.cur_pw && p.new_pw){
		var param = [p.member_id, p.cur_pw, p.new_pw];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL chgPw(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result == 1){
							sendResponse(req, res, json);
						}else if(rs.result == -1){
							json = {status:'-72',message:'current password is invalid'};
							sendResponse(req, res, json);
						}else{
							json = {status:'-99',message:'System Error'};
							sendResponse(req, res, json);
						}
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function reqIssuePw(req, res){
	var json = {status:'OK',message:''};
	var p = req.headers;
	logger.info(req.headers);
	if(p['content-length'] > 0){
		if(req.method == 'POST'){
			var bufs = [];
			bufs.totalLength = 0;
			req.on('data', function(chunk){
				if(chunk){
					bufs.push(chunk);
					bufs.totalLength += chunk.length;
				}
			});
			req.on('end', function(){
				logger.info('bufs.totalLength:'+bufs.totalLength);
				if(bufs.totalLength == 0){
					json = {status:'-2',message:'parameter invalid'};
					sendResponse(req, res, json);
				}else{
					var data = Buffer.concat(bufs, bufs.totalLength);
					var post = qs.parse(data.toString());
					var param = [
						post.email, 
						post.name,
						post.locale
					];
					var paramCheck = true;
					param.forEach(function(d, idx){
						if(d) {
						}else{
							paramCheck = false;
						}
					});
					logger.info(param);
					if(paramCheck){
						pool.getConnection(function(err, conn){
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								conn.query('CALL reqIssuePw(?,?,?)',param, function(err, result){
									conn.release();
									if(err){
										logger.error(err.message);
										json = {status:'-99',message:'System Error'};
										sendResponse(req, res, json);
									}else{
										var rs = result[0][0];
										if(rs.result == 1){
											sendResponse(req, res, json);
											mail.sendMailForReqIssuePw(rs.email, rs.id, rs.seq, rs.name, rs.reqname, rs.expire_date, post.locale);
										}else{
											json = {status:'-13',message:'not found member'};
											sendResponse(req, res, json);
										}
									}
								});
							}
						});
					}else{
						json = {status:'-2',message:'parameter invalid'};
						sendResponse(req, res, json);
					}
				}
			});
		}else{
			json = {status:'-6',message:'http request bad method'};
			sendResponse(req, res, json);
		}
	}else{
		req.removeListener('data', function(){
		});
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNewsList(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id){
		var param = [p.member_id, p.device_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL getNewsList(?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							json['news_cnt'] = result[0].length;
							var news = [];
							result[0].forEach(function(d, idx){
								var obj = {
									member_id: d.member_id + '',
									device_id: d.device_id + '',
									seq: d.seq + '',
									thread_type: d.thread_type + '',
									thread_subtype: d.thread_subtype + '',
									thread_id: d.thread_id + '',
									createtime: d.createtime
								};
								news.push(obj);
							});
							json['news'] = news;
						}else{
							json['news_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getDeviceTokens(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id){
		var param = [p.member_id];
		pool.getConnection(function(err, conn){
			if(err){
				json['device_cnt'] = 0;
				sendResponse(req, res, json);
				logger.error(err.message);
			}else{
				var param = [p.member_id];
				conn.query('CALL getDeviceTokens(?)',param, function(err, result){
					conn.release();
					if(err){
						json['device_cnt'] = 0;
						logger.error(err.message);
					}else{
						var device_cnt = result[0].length;
						json['device_cnt'] = device_cnt;
						if(device_cnt > 0){
							var devices = [];
							result[0].forEach(function(d, idx){
								logger.info(d);
								var device = {
									id: d.id + '',
									type: d.type,
									token: d.token,
									locale: d.locale
								};
								devices.push(device);
							});
							json['devices'] = devices;
						}else{
							json['device_cnt'] = 0;
						}
					}
					sendResponse(req, res, json);
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNewsDetail(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id && p.seq){
		var param = [p.member_id, p.device_id, p.seq];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getNewsDetail(?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var d = result[0][0];
							json['news_cnt'] = 1;
							var news = [];
							var newsTmp = {
								id: d.id + '',
								contents: d.contents,
								status: d.status + '',
								createtime: d.createtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							if(d.thread_type == 2){
								newsTmp['date'] = d.date;
							}
							var targetTotalCnt = 0;
							var targetReadCnt = 0;
							if(d.thread_type == 1 || d.thread_type == 2 || d.thread_type == 3){
								newsTmp['readyn'] = d.readyn;
								newsTmp['readtime'] = d.readtime;
								newsTmp['type'] = d.type;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								newsTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
							}
							if(d.thread_type == 3){
								newsTmp['address'] = d.address;
								newsTmp['date'] = d.date;
							}
							if(d.thread_type == 1 || d.thread_type == 3 || d.thread_type == 6){
								newsTmp['title'] = d.title;
								newsTmp['goodcnt'] = d.goodcnt;
							}
							if(d.img1 != ''){
								newsTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								newsTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								newsTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								newsTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								newsTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								newsTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								newsTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								newsTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								newsTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								newsTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								newsTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								newsTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							if(d.thread_type == 1){
								newsTmp['schedule_added_yn'] = d.schedule_added_yn + '';
							}
							news.push(newsTmp);
							json['news'] = news;
						}else{
							json['news_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNewsDetail2(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id && p.seq && p.demo){
		var param = [p.member_id, p.device_id, p.seq, p.demo];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getNewsDetail2(?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var d = result[0][0];
							json['news_cnt'] = 1;
							var news = [];
							var newsTmp = {
								id: d.id + '',
								contents: d.contents,
								status: d.status + '',
								createtime: d.createtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							if(d.thread_type == 2){
								newsTmp['date'] = d.date;
							}
							var targetTotalCnt = 0;
							var targetReadCnt = 0;
							if(d.thread_type == 1 || d.thread_type == 2 || d.thread_type == 3){
								newsTmp['readyn'] = d.readyn;
								newsTmp['readtime'] = d.readtime;
								newsTmp['type'] = d.type;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								newsTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
							}
							if(d.thread_type == 3){
								newsTmp['address'] = d.address;
								newsTmp['date'] = d.date;
							}
							if(d.thread_type == 1 || d.thread_type == 3 || d.thread_type == 6){
								newsTmp['title'] = d.title;
								newsTmp['goodcnt'] = d.goodcnt;
							}
							if(d.img1 != ''){
								newsTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								newsTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								newsTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								newsTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								newsTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								newsTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								newsTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								newsTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								newsTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								newsTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								newsTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								newsTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							if(d.thread_type == 1){
								newsTmp['schedule_added_yn'] = d.schedule_added_yn + '';
							}
							news.push(newsTmp);
							json['news'] = news;
						}else{
							json['news_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getNewsDetail3(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.member_id && p.device_id && p.seq && p.demo){
		var kidsId = p.kids_id ? p.kids_id : -1;
		var param = [p.member_id, p.device_id, p.seq, kidsId, p.demo];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				logger.info(param);
				conn.query('CALL getNewsDetail3(?,?,?,?,?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						if(result[0]){
							var d = result[0][0];
							json['news_cnt'] = 1;
							var news = [];
							var newsTmp = {
								id: d.id + '',
								contents: d.contents,
								status: d.status + '',
								createtime: d.createtime,
								writer: {
									id: d.writer_id + '',
									type: d.writer_type,
									name: d.writer_name,
									img: d.writer_img == '' ? '' : config.http.url + '' + d.writer_img
								},
								reply_cnt: d.reply_cnt,
							};
							if(d.thread_type == 2){
								newsTmp['date'] = d.date;
							}
							var targetTotalCnt = 0;
							var targetReadCnt = 0;
							if(d.thread_type == 1 || d.thread_type == 2 || d.thread_type == 3){
								newsTmp['readyn'] = d.readyn;
								newsTmp['readtime'] = d.readtime;
								newsTmp['type'] = d.type;
								if(d.target_totalcnt){
									targetTotalCnt = d.target_totalcnt;
								}
								if(d.target_readcnt){
									targetReadCnt = d.target_readcnt;
								}
								newsTmp['target'] = {
									total_cnt: targetTotalCnt,
									read_cnt: targetReadCnt
								}
							}
							if(d.thread_type == 3){
								newsTmp['address'] = d.address;
								newsTmp['date'] = d.date;
							}
							if(d.thread_type == 1 || d.thread_type == 3 || d.thread_type == 6){
								newsTmp['title'] = d.title;
								newsTmp['goodcnt'] = d.goodcnt;
							}
							if(d.img1 != ''){
								newsTmp['img1'] = {
									url: config.http.url + '' + d.img1,
									w: d.img1w,
									h: d.img1h
								};
							}
							if(d.img2 != ''){
								newsTmp['img2'] = {
									url: config.http.url + '' + d.img2,
									w: d.img2w,
									h: d.img2h
								};
							}
							if(d.img3 != ''){
								newsTmp['img3'] = {
									url: config.http.url + '' + d.img3,
									w: d.img3w,
									h: d.img3h
								};
							}
							if(d.img4 != ''){
								newsTmp['img4'] = {
									url: config.http.url + '' + d.img4,
									w: d.img4w,
									h: d.img4h
								};
							}
							if(d.img5 != ''){
								newsTmp['img5'] = {
									url: config.http.url + '' + d.img5,
									w: d.img5w,
									h: d.img5h
								};
							}
							if(d.img6 != ''){
								newsTmp['img6'] = {
									url: config.http.url + '' + d.img6,
									w: d.img6w,
									h: d.img6h
								};
							}
							if(d.img7 != ''){
								newsTmp['img7'] = {
									url: config.http.url + '' + d.img7,
									w: d.img7w,
									h: d.img7h
								};
							}
							if(d.img8 != ''){
								newsTmp['img8'] = {
									url: config.http.url + '' + d.img8,
									w: d.img8w,
									h: d.img8h
								};
							}
							if(d.img9 != ''){
								newsTmp['img9'] = {
									url: config.http.url + '' + d.img9,
									w: d.img9w,
									h: d.img9h
								};
							}
							if(d.img10 != ''){
								newsTmp['img10'] = {
									url: config.http.url + '' + d.img10,
									w: d.img10w,
									h: d.img10h
								};
							}
							if(d.class_id){
								newsTmp['class'] = {
									id: d.class_id,
									name: d.class_name
								}		
							}else{
								newsTmp['class'] = {
									id: '',
									name: '' 
								}
							}
							if(d.thread_type == 1){
								newsTmp['schedule_added_yn'] = d.schedule_added_yn + '';
							}
							news.push(newsTmp);
							json['news'] = news;
						}else{
							json['news_cnt'] = 0;
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getCenterAskApprovalList(req, res) {
	var p = url.parse(req.url, true).query;
	var json = {status:'OK',message:''};
	var param = [];
	pool.getConnection(function(err, conn){
		if(err){
			logger.error(err.message);
			json = {status:'-99',message:'System Error'};
			sendResponse(req, res, json);
		}else{
			conn.query('CALL getCenterAskApprovalList()',param, function(err, result){
				conn.release();
				if(err){
					logger.error(err.message);
					json = {status:'-99',message:'System Error'};
					sendResponse(req, res, json);
				}else{
					if(result[0]){
						var approval_cnt = result[0].length;
						json['approval_cnt'] = approval_cnt;
						var approval = [];
						result[0].forEach(function(d, idx){
							approval.push({
								center_id: d.center_id + '',
								center_type_name: d.center_type_name,
								center_name: d.center_name,
								member_id: d.member_id,
								member_name: d.member_name,
								email: d.email,
								img: d.member_img == '' ? '' : config.http.url + '' + d.member_img,
								phonenum: d.phonenum,
								country_name: d.country_name,
								state_name: d.state_name,
								city_name: d.city_name,
								address_detail: d.address_detail,
								approval_state: d.approval_state,
								createtime: d.createtime
							});
						});
						json['approval'] = approval;
					}else{
						json['approval_cnt'] = 0;
					}
					sendResponse(req, res, json);
				}
			});
		}
	});
}

function doCenterAskApprove(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL doCenterAskApprove(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
							push.doCenterApproveRequestSuccess(pool, p.center_id);
						}else{
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function deleteCenterAskApprove(req, res) {
	var p = url.parse(req.url, true).query;
	logger.info(p);
	var json = {status:'OK',message:''};
	if(p.center_id){
		var param = [p.center_id];
		pool.getConnection(function(err, conn){
			if(err){
				logger.error(err.message);
				json = {status:'-99',message:'System Error'};
				sendResponse(req, res, json);
			}else{
				conn.query('CALL deleteCenterAskApprove(?)',param, function(err, result){
					conn.release();
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						var rs = result[0][0];
						logger.info(rs);
						if(rs.result){
						}else{
							json = {status:'-99',message:'System Error'};
						}
						sendResponse(req, res, json);
					}
				});
			}
		});
	}else{
		json = {status:'-2',message:'parameter invalid'};
		sendResponse(req, res, json);
	}
}

function getCenterListByName(req, res){
	var json = {status:'OK',message:''};
	if(req.method == 'POST'){
		var bufs = [];
		bufs.totalLength = 0;
		req.on('data', function(chunk){
			if(chunk){
				bufs.push(chunk);
				bufs.totalLength += chunk.length;
			}
		});
		req.on('end', function(){
			logger.info('bufs.totalLength:'+bufs.totalLength);
			var data = Buffer.concat(bufs, bufs.totalLength);
			var p = qs.parse(data.toString());
			logger.info(p);
			if(p.center_name && p.center_type){
				var param = [p.center_name, p.center_type];
				pool.getConnection(function(err, conn){
					if(err){
						logger.error(err.message);
						json = {status:'-99',message:'System Error'};
						sendResponse(req, res, json);
					}else{
						logger.info(param);
						conn.query('CALL getCenterListByName(?,?)',param, function(err, result){
							conn.release();
							if(err){
								logger.error(err.message);
								json = {status:'-99',message:'System Error'};
								sendResponse(req, res, json);
							}else{
								if(result[0]){
									json['center_cnt'] = result[0].length;
									var center = [];
									result[0].forEach(function(d, idx){
										var obj = {
											center_id: d.center_id + '',
											center_name: d.center_name,
											country_id: d.country_id + '',
											country_name: d.country_name,
											state_id: d.state_id + '',
											state_name: d.state_name,
											city_id: d.city_id + '',
											city_name: d.city_name,
											address_detail: d.address_detail,
											invitation_code: d.invitation_code + '',
											regist_date: d.regist_date
										};
										center.push(obj);
									});
									json['center'] = center;
								}else{
									json['center_cnt'] = 0;
								}
								sendResponse(req, res, json);
							}
						});
					}
				});
			}else{
				req.removeListener('data', function(){
				});
				json = {status:'-2',message:'parameter invalid'};
				sendResponse(req, res, json);
			}
		});
	}else{
		json = {status:'-6',message:'http request bad method'};
		sendResponse(req, res, json);
	}
}
exports.sendCommonResponse = sendCommonResponse;
exports.getCountryList = getCountryList;
exports.getStateList = getStateList;
exports.getCityList = getCityList;
exports.getCenterList = getCenterList;
exports.getClassList = getClassList;
exports.login = login;
exports.emailCheck = emailCheck;
exports.access = access;
exports.getNoticeList = getNoticeList;
exports.getNoticeDetail = getNoticeDetail;
exports.getNoticeReplyList = getNoticeReplyList;
exports.getNoticeReplyList2 = getNoticeReplyList2;
exports.getMemberListNotReadNotice = getMemberListNotReadNotice;
exports.postNoticeContents = postNoticeContents;
exports.postNoticeImageZip = postNoticeImageZip;
exports.postNoticeImage = postNoticeImage;
exports.deleteNoticeImage = deleteNoticeImage;
exports.deleteNotice = deleteNotice;
exports.deleteNoticeReply = deleteNoticeReply;
exports.sendNoticeRead = sendNoticeRead;
exports.postNoticeReply = postNoticeReply;
exports.postNoticeReply2 = postNoticeReply2;
exports.updateNoticeContents = updateNoticeContents;
exports.postMemberType1Info = postMemberType1Info;
exports.postMemberType2Info = postMemberType2Info;
exports.postMemberType2Info_121 = postMemberType2Info_121;
exports.postMemberType3Info = postMemberType3Info;
exports.updateKidsInfo = updateKidsInfo;
exports.addKidsInfo = addKidsInfo;
exports.addAlbumData = addAlbumData;
exports.getAlbumList = getAlbumList;
exports.getAlbumList2 = getAlbumList2;
exports.deleteAlbumData = deleteAlbumData;
exports.getScheduleList = getScheduleList;
exports.getScheduleList2 = getScheduleList2;
exports.getScheduleDetail = getScheduleDetail;
exports.getScheduleDetail2 = getScheduleDetail2;
exports.addScheduleDataByThread = addScheduleDataByThread;
exports.addScheduleDataByThread2 = addScheduleDataByThread2;
exports.addScheduleData = addScheduleData;
exports.addScheduleData2 = addScheduleData2;
exports.deleteScheduleData = deleteScheduleData;
exports.plusNoticeGoodCnt = plusNoticeGoodCnt;
exports.getAskApprovalList = getAskApprovalList;
exports.postDailyMenuData = postDailyMenuData;
exports.getDailyMenuList = getDailyMenuList;
exports.deleteDailyMenuData = deleteDailyMenuData;
exports.doAskApprove = doAskApprove;
exports.deleteAskApprove = deleteAskApprove;
exports.activateKids = activateKids;
exports.postEventContents = postEventContents;
exports.getEventList = getEventList;
exports.getEventDetail = getEventDetail;
exports.postEventImage = postEventImage;
exports.postEventReply = postEventReply;
exports.postEventReply2 = postEventReply2;
exports.getEventReplyList = getEventReplyList;
exports.getEventReplyList2 = getEventReplyList2;
exports.getMemberListNotReadEvent = getMemberListNotReadEvent;
exports.deleteEventImage = deleteEventImage;
exports.updateEventContents = updateEventContents;
exports.deleteEvent = deleteEvent;
exports.deleteEventReply = deleteEventReply;
exports.sendEventRead = sendEventRead;
exports.plusEventGoodCnt = plusEventGoodCnt;
exports.getMngClassList = getMngClassList;
exports.postClassInfo = postClassInfo;
exports.updateClassInfo = updateClassInfo;
exports.deleteClassInfo = deleteClassInfo;
exports.getMemberInfo = getMemberInfo;
exports.updateMemberType2Info = updateMemberType2Info;
exports.updateMemberType2Info_121 = updateMemberType2Info_121;
exports.updateMemberType1Info = updateMemberType1Info;
exports.updateMemberType3Info = updateMemberType3Info;
exports.updateDeviceToken = updateDeviceToken;
exports.postMamaTalkContents = postMamaTalkContents;
exports.postMamaTalkContents2 = postMamaTalkContents2;
exports.postMamaTalkImage = postMamaTalkImage;
exports.deleteMamaTalkImage = deleteMamaTalkImage;
exports.getMamaTalkList = getMamaTalkList;
exports.postMamaTalkReply = postMamaTalkReply;
exports.postMamaTalkReply2 = postMamaTalkReply2;
exports.deleteMamaTalkReply = deleteMamaTalkReply;
exports.getMamaTalkReplyList = getMamaTalkReplyList;
exports.getMamaTalkReplyList2 = getMamaTalkReplyList2;
exports.updateMamaTalkContents = updateMamaTalkContents;
exports.deleteMamaTalk = deleteMamaTalk;
exports.plusMamaTalkGoodCnt = plusMamaTalkGoodCnt;
exports.getMamaTalkDetail = getMamaTalkDetail;
exports.setPushReceiveYn = setPushReceiveYn;
exports.getPushReceiveYnList = getPushReceiveYnList;
exports.pushNotReadNoticeMemberList = pushNotReadNoticeMemberList;
exports.pushNotReadEventMemberList = pushNotReadEventMemberList;
exports.getCenterTypeList = getCenterTypeList;
exports.postContactContents = postContactContents;
exports.postContactContents2 = postContactContents2;
exports.postContactImage = postContactImage;
exports.getContactList = getContactList;
exports.getContactList2 = getContactList2;
exports.deleteContactImage = deleteContactImage;
exports.postContactReply = postContactReply;
exports.postContactReply2 = postContactReply2;
exports.getContactReplyList = getContactReplyList;
exports.getContactReplyList2 = getContactReplyList2;
exports.deleteContactReply = deleteContactReply;
exports.updateContactContents = updateContactContents;
exports.deleteContact = deleteContact;
exports.sendContactRead = sendContactRead;
exports.sendContactRead2 = sendContactRead2;
exports.getMemberListNotReadContact = getMemberListNotReadContact;
exports.pushNotReadContactMemberList = pushNotReadContactMemberList;
exports.getKidsList = getKidsList;
exports.checkAttendance = checkAttendance;
exports.getAttendanceInfo = getAttendanceInfo;
exports.changeKidsClass = changeKidsClass;
exports.voidKidsApproval = voidKidsApproval;
exports.getVersions = getVersions;
exports.changeTeacherClass = changeTeacherClass;
exports.changeTeacherClass_121 = changeTeacherClass_121;
exports.getTeacherList = getTeacherList;
exports.getTeacherList_121 = getTeacherList_121;
exports.voidTeacherApproval = voidTeacherApproval;
exports.setInvitationCode = setInvitationCode;
exports.getInvitationCode = getInvitationCode;
exports.getBadge = getBadge;
exports.getBadge2 = getBadge2;
exports.setBadge = setBadge;
exports.setBadge2 = setBadge2;
exports.setLocale = setLocale;
exports.chgPw = chgPw;
exports.reqIssuePw = reqIssuePw;
exports.getNewsList = getNewsList;
exports.getDeviceTokens = getDeviceTokens;
exports.getNewsDetail = getNewsDetail;
exports.getNewsDetail2 = getNewsDetail2;
exports.getNewsDetail3 = getNewsDetail3;
exports.getCenterAskApprovalList = getCenterAskApprovalList;
exports.doCenterAskApprove = doCenterAskApprove;
exports.deleteCenterAskApprove = deleteCenterAskApprove;
exports.getCenterListByName = getCenterListByName;
exports.getMessageTime = getMessageTime;
exports.setMessageTime = setMessageTime;
