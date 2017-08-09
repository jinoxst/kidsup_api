exports.config = {
	serverType: 'https',
	http: {
		url: 'https://www.kidsup.net',
		port: 1234
	},
	https: {
		port: 1234,
		key: './cert/https_key.pem',
		cert: './cert/https_cert.pem',
		ca: './cert/https_bundle.pem',
		passphrase: 'passphrase'
	},
	https_bak: {
		port: 1234,
		key: './cert_bak/https_key.pem',
		cert: './cert_bak/https_cert.pem',
		ca: './cert_bak/https_bundle.pem'
	},
	db: {
		host: 'localhost',
		database : 'KIDSUP',
		user: 'user',
		password: 'password',
		charset: 'utf8mb4'
	},
	mainImagePath: '/var/www/html/images/main/',
	workImagePath: '/var/www/html/images/work/',
	userContentMaxSize: 3 * 1000 * 1000,
	userZipMaxSize: 10 * 1000 * 1000,
	noticeImageZipName: 'noticeimage.zip',
	chgWidth: 400,
	thmWidth: 200,
	thmProfileWidth: 200,
	imageQuality: 75,
	regexpImageFileExt: /\.(gif|jpg|jpeg|tiff|png)$/i,
	regexpEmailAddress: /^([a-zA-Z0-9\.\_\-\/]+)@([a-zA-Z0-9\._\-]+)\.([a-zA-Z]+)$/,
	noticeDir: 'notice',
	eventDir: 'event',
	mamatalkDir: 'mamatalk',
	contactDir: 'contact',
	kidsDir: 'kids',
	orgDir: 'org',
	chgDir: 'chg',
	thmDir: 'thm',
	memberDir: 'member',
	thmTail: '_thm',
	dailymenuDir: 'dailymenu',
	splitDelimiter: '__N__',
	push: {
		android: {
			collapseKey: 'KidsUp',
			apiKey: 'AIzaSyBSJ4tY-uaHfPBnPTT5yuJlo9vVdCgXLdY',
			delayWhileIdle: false,
			timeToLive: 60 * 60 * 24 * 5,
			retryCnt: 4
		},
		ios:{
			cert: './cert/aps_production_cer.pem',
			key: './cert/aps_production_key.pem',
			gateway: 'gateway.push.apple.com',
			port: 2195,
			sound: 'default'
		},
		alertLength: 100
	},
	crypto: {
		key: '9986b4802ba336f6',
		iv: '12595b352fcca3e2'
	},
	email:{
		format_file: {
			issue_pw: '/var/www/html/web/public/issue_pw_plain.html',
			service_start: '/var/www/html/web/public/service_start_plain.html' 
		},
		from: 'support@kidsup.net',
		web_root: 'http://web.kidsup.net'
	}
}
