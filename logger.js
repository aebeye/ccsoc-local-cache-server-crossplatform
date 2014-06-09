var path = require('path')
  , config = require(path.join(__dirname, "config.js"))
  , getmac = require('getmac').getMac
  , winston = require('winston')
  , util = require('util')
  , mkdirp = require('mkdirp')
  , logDirectory = path.join(__dirname, "log");

var SeerLogger;

var logger = new winston.Logger({
	transports: [
		new winston.transports.Console({
			handleExceptions: true,
			colorize: true,
			level: 'debug'
		})
	]
});

mkdirp(logDirectory,function(error) {
	if(error) return logger.error("Failed to create log directory "+logDirectory);
	logger.add(winston.transports.File, {
		filename: path.join(__dirname, "log", "service.log"),
		handleExceptions: true,
		json: false,
		maxFiles: config.maximumLogFiles,
		maxsize: config.maximumLogFileSize,
		level: config.logLevel
	});
});

if(config.useSeerLogger) {
	getmac(function(err,userId){
		if (err) throw err;
		logger.info("ID being used for Seer Logger: "+userId);
		SeerLogger = winston.transports.SeerLogger = function (options) {
			this.name = 'SeerLogger';
			return this.level = options.level || 'info';
		};
		util.inherits(SeerLogger, winston.Transport);
		SeerLogger.prototype.log = function (level, msg, meta, callback) {
			if ((meta && meta.verb && !meta.noSeer) || ((level === 'warn' || level === 'error') && (meta && !meta.noSeer))) {
				new Seer({
					rootUrl: config.reportingUrl,
					appId: config.reportingAppId,
					password: config.reportingPassword,
					dryRunMode: false
				}).emitActivity({
					actor: {
						id: userId
					},
					verb: meta.verb || level,
					object: {
						id: msg || ' ',
						objectType: 'cache-service'
					},
					generator: {
						appId: config.reportingAppId
					},
					published: new Date()
				}, function (error, response, body) {
					if (error) {
						return logger.error('error submitting event', {
							noSeer: true
						});
					}
				});
			}
			return callback(null, true);
		};
		logger.add(winston.transports.SeerLogger, {
			level: config.logLevel
		});
	});
}

module.exports = logger;