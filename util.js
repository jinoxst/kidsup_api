var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var config = require('./config').config;

function sha1(data){
	var sha1sum = crypto.createHash('sha1');
	sha1sum.update(data);
	return sha1sum.digest('hex');
}

function getFileNameOnly(file){
	return file.substr(0,file.lastIndexOf('.'));
}

function getFileNameExt(file){
	return file.substr(file.lastIndexOf('.') + 1);
}

function mkdirParent(dirPath, mode, callback) {
	fs.mkdir(dirPath, mode, function(error) {
		if (error && error.errno === 34) {
			mkdirParent(path.dirname(dirPath), mode, callback);
			mkdirParent(dirPath, mode, callback);
		}
		callback && callback(error);
	});
};

function deleteFolderRecursive(path) {
	var files = [];
	if( fs.existsSync(path) ) {
		files = fs.readdirSync(path);
		files.forEach(function(file,index){
			var curPath = path + "/" + file;
			if(fs.lstatSync(curPath).isDirectory()) { // recurse
				deleteFolderRecursive(curPath);
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		});
		fs.rmdirSync(path);
	}
};

function isValidEmailAddress(email) {
	var pattern = config.regexpEmailAddress;
	return pattern.test(email);
}

exports.sha1 = sha1;
exports.getFileNameOnly = getFileNameOnly;
exports.getFileNameExt = getFileNameExt;
exports.mkdirParent = mkdirParent;
exports.deleteFolderRecursive = deleteFolderRecursive;
exports.isValidEmailAddress = isValidEmailAddress;
