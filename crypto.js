var crypto = require('crypto');
var config = require('./config').config;

function encrypt(data){
	var cipher = crypto.createCipheriv('aes-128-cbc', config.crypto.key, config.crypto.iv);
	var crypted = cipher.update(data, 'utf8', 'hex');
	crypted += cipher.final('hex');
	return crypted;
}

function decrypt(data){
	var decipher = crypto.createDecipheriv('aes-128-cbc', config.crypto.key, config.crypto.iv);
	var decrypted = decipher.update(data, 'hex', 'utf8');
	decrypted += decipher.final('utf8');
	return decrypted;
}

exports.encrypt = encrypt;
exports.decrypt = decrypt;
