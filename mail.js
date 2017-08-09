var fs = require('fs');
var nodemailer = require('nodemailer');
var config = require('./config').config;
var crypto = require('./crypto');
var log4js = require('log4js');
log4js.configure('log4js.json', {});
var logger = log4js.getLogger();
logger.setLevel('INFO');

function sendMailForReqIssuePw(email, id, seq, name, reqname, expire_date, locale) {
	fs.readFile(config.email.format_file.issue_pw, 'utf8', function(err, html){
		if(err){
			logger.error(err);
		}else{
			if(locale != 'ja' && locale != 'en' && locale != 'ko') {
				locale = 'en';
			}
			locale = 'ja';
			var lang = require('./i18n/' + locale);
			var mailContents = lang.PW_REISSUE_MAIL_CONTENTS.replace("%_NAME_%", name).replace('%_REQNAME_%', reqname).replace('%_EXPIREDATE_%', expire_date);
			html = html.replace('%_MAILCONTENTS_%', mailContents).replace(/%_WEB_ROOT_%/g, config.email.web_root);
			html = html.replace('%_MID_%', crypto.encrypt(id + '')).replace('%_SEQ_%', crypto.encrypt(seq + ''));
			html = html.replace('%_PAGE_TITLE_%', lang.PAGE_TITLE);
			html = html.replace('%_LOCALE_%', locale);
			html = html.replace('%_LINK_%', lang.PW_REISSUE_LINK);
			var mailOptions = {
				from: lang.FROM_STR + '<' + config.email.from + '>',
				to: email,
				subject: lang.MAIL_TITLE,
				html: html
			}
			/*var transporter = nodemailer.createTransport({
				service: 'localhost'
			});*/
			var transporter = nodemailer.createTransport();
			transporter.sendMail(mailOptions, function(err, info){
				if(err){
					logger.error(err);
				}else{
					logger.info('Message sent:' + JSON.stringify(info));
				}
				transporter.close();
			});
		}
	});
}

function sendMailForServiceStart(email, center_id, center_name, locale) {
	fs.readFile(config.email.format_file.service_start, 'utf8', function(err, html){
		if(err){
			logger.error(err);
		}else{
			if(locale != 'ja' && locale != 'en' && locale != 'ko') {
				locale = 'en';
			}
			locale = 'ja';
			var lang = require('./i18n/' + locale);
			var mailContents = lang.MEMBER1_JOIN_COMPLETE_MAIL_CONTENTS.replace("%_CENTER_NAME_%", center_name);
			html = html.replace('%_MAILCONTENTS_%', mailContents).replace(/%_WEB_ROOT_%/g, config.email.web_root);
			html = html.replace('%_CID_%', crypto.encrypt(center_id + ''));
			html = html.replace('%_PAGE_TITLE_%', lang.PAGE_TITLE);
			html = html.replace('%_LOCALE_%', locale);
			html = html.replace('%_LINK_%', lang.SERVICE_START_LINK);
			logger.info(html);
			var mailOptions = {
				from: lang.FROM_STR + '<' + config.email.from + '>',
				to: email,
				subject: lang.MEMBER1_REGIST_COMPLETE_TITLE,
				html: html
			}
			/*var transporter = nodemailer.createTransport({
				service: 'localhost'
			});*/
			var transporter = nodemailer.createTransport();
			transporter.sendMail(mailOptions, function(err, info){
				if(err){
					logger.error(err);
				}else{
					logger.info('Message sent:' + JSON.stringify(info));
				}
				transporter.close();
			});
		}
	});
}

exports.sendMailForReqIssuePw = sendMailForReqIssuePw;
exports.sendMailForServiceStart = sendMailForServiceStart;
