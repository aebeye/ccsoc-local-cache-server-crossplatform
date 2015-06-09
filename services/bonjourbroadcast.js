'use strict';

var config = require('../config'),
    logger = require('../logger.js'),
    exec = require('child_process').exec;

// The main entry point for starting the zeroconf (bonjour) broadcast
exports.startBroadCast = function startBonjourBroadcast() {
    var bonjourServiceType = '_ccsoc-' + config.environmentIdentifier.toLowerCase() + '._tcp';
    logger.info("Starting zeroconf (bonjour) broadcast for service " + bonjourServiceType);
    // dns-sd is part of the Apple Bonjour SDK (available for windows and mac)
    // the -R option registers a service
    // dns-sd -R <Name> <Type> <Domain> <Port> [<TXT>...] (Register a service)
    var txtRecord;
    if (config.broadcastDetails) {
        txtRecord = [
                "VERSION=" + packageinfo.version,
                "OS_TYPE=" + os.type(),
                "OS_PLATFORM=" + os.platform(),
                "OS_ARCH=" + os.arch()
        ].join(" ");
    } else {
        txtRecord = "";
    }
    exec('dns-sd -R "CCSoC Cache Server" ' + bonjourServiceType + ' local ' + config.port + " " + txtRecord, function(error, stdout, stderr) {
        logger.error("Zeroconf (bonjour) stopped; will attempt to restart it after a brief timeout", { out: stdout, err: stderr });
        // try to restart the broadcast in a little while if it stops for any reason
        setTimeout(startBonjourBroadcast, 10000);
    });
};