var config = require(__dirname + '/config.js')
  , u = require('underscore')
  , express = require('express')
  , mkdirp = require('mkdirp')
  , path = require('path')
  , azure = require('azure')
  , logger = require(path.join(__dirname, "logger.js"))
  , crypto = require('crypto')
  , fs = require('fs')
  , util = require('util')
  , temp = require('temp')
  , request = require('request')
  , mv = require('mv')
  , os = require('os')
  , exec = require('child_process').exec
  , app = express()
  , config = require(path.join(__dirname, "config.js"))
  , packageinfo = require(path.join(__dirname, "package.json"))
  , contentDirectory = path.join(__dirname, "content")
  , async = require('async')
  , configCodeService = require(__dirname + '/services/configcode');

/* Global variables */
var downloadsRunning = [] // array of currently downloading blobs
  , contentSyncActive = false // set to true when a full content sync is underway as a means to stop the web server from handling requests during this time
  , downloadQueue = [] // downloads that are not yet running, but queued to be when their time comes
  , downloadQueueSize = 0 // content length of items in queue
  , lastAzureDownloadSpeed = 0
    //Content Set to be fetched in content set
  , identifiedContentSet = '00000000-0000-0000-0000-000000000000';

// convert number of bytes into a more human readable format
function humanFileSize(bytes, si) {
	var thresh = si ? 1000 : 1024;
	if(bytes < thresh) return bytes + ' B';
	var units = si ? ['kB','MB','GB','TB','PB','EB','ZB','YB'] : ['KiB','MiB','GiB','TiB','PiB','EiB','ZiB','YiB'];
	var u = -1;
	do {
		bytes /= thresh;
		++u;
	} while(bytes >= thresh);
	return bytes.toFixed(1)+' '+units[u];
};  

// compares two 'download info' queue objects against each other based on the blob name and container name
function compareBlobs(inputBlob) {
	return inputBlob.blobName == this.blobName && inputBlob.blobContainerName == this.blobContainerName;
}
function compareBlobsN(inputBlob) { // negated
	return inputBlob.blobName != this.blobName || inputBlob.blobContainerName != this.blobContainerName;
}

// Logging function for HTTP requests
function logWebRequest(req, res){
	var success = (res.statusCode === 200 || res.statusCode === 304 || res.statusCode === 206) ? 'SUCCESS' : 'FAIL'
	  , contentLengthBytes = parseInt(res.get('content-length') || 0, 10)
	  , contentLengthKiloBytes = contentLengthBytes / 1024
	  , responseTime = (new Date() - req._startTime) / 1000
	  , bandwidth = Math.ceil(contentLengthKiloBytes/responseTime,2);
	logger.info('%s %s - %s %s %s %s bytes - %s ms - %s kbps', success, req.ip, req.method, req.url, res.statusCode, contentLengthBytes, responseTime, bandwidth );
}

/* Configures and starts the web server for hosting content */
// Example URL: http://localhost:8888/half/00000000-0000-0000-0000-000000000000/grade10-ela-mastercontent/grade10_ela_unit5_lesson7_task3_step1.html
function startWebServer() {
	// set start time for any request, so we can measure response time
	app.use(function(req,res,next) {
		req._startTime = new Date();
		next();
	});
	// health check functionality
    app.get('/', function (req, res) {
        res.send({
			'status': 'OK',
			'download-status': {
				'totals': {
					'items-in-queue': downloadQueue.length,
					'total-bytes': downloadQueueSize,
					'total-filesize': humanFileSize(downloadQueueSize,true),
					'current-download-count': downloadsRunning.length
				},
				'averages': {
					'file-size': humanFileSize((downloadQueueSize/downloadQueue.length) || 0 ,true)
				},
				'speed-of-last-transfer': humanFileSize(lastAzureDownloadSpeed,true)+"/sec",
				'estimated-seconds-remaining': parseInt(((downloadQueueSize/lastAzureDownloadSpeed) || 0).toFixed(0)),
				'currentDownloads': u.map(downloadsRunning,function(x) { return {'container':x.blobContainerName, 'name': x.blobName, 'size': humanFileSize(x.size,true) }; })
			}
		});
		logWebRequest(req,res);
    });
	// when doing browser testing, this is useful to stop the server from trying to fetch the favicon from azure by accident
	app.get('/favicon.ico', function (req, res) {
        res.send(404,"No Such Resource");
		logWebRequest(req,res);
    });
	// During a content sync, the service should not be accessible
	app.use(function(req, res, next){
		if(!contentSyncActive) return next();
		res.send(503,"Service unavailable during content sync"); // TODO Confirm if the iOS app will actually accept this response code properly; Ivan says it may be only looking for 404s even though it is not appropriate for this situation
	});
	// The core functionality to send content to the clients
	app.get(/^.*/, function(req, res) {
		res.sendfile(req.path, {root:contentDirectory, hidden: true}, function(error) {
			var deferredToAzure = false;
			// if the file does not exist...
			if(error && error.errno === 34) {
				var pathArray = req.path.split("/");
				// ensure that on-demand downloads is enabled in the config before proceeding with the request
				// a correct URL will always have at least 3 elements because the first is empty, the second is the container, and the third+onwards is going to be the blob name
				if(!config.allowOnDemand || pathArray.length < 3) {
					return res.send(404,"Not Found");
				}
				// since a path always starts with '/' the first element will always be empty
				pathArray.shift();
				// the directory at the root of the request is going to be the container name
				var blobContainerName = pathArray.shift();
				// validate the blob container name against the values listed in http://msdn.microsoft.com/en-us/library/dd135715.aspx
				if(!blobContainerName.match(/^([a-z0-9](-[a-z0-9])?)+$/) || blobContainerName.length < 3 || blobContainerName.length > 63) {
					logger.warn("On demand request with invalid container name '%s' dropped",blobContainerName);
					return res.send(400,"Bad Request");
				}
				// the rest of the path is the blob name
				var blobName = pathArray.join("/");
				// create the object used to compare or put into download queue
				var dqInfo = {
					'destinationFilename': path.join(contentDirectory,blobContainerName,blobName),
					'blobContainerName': blobContainerName,
					'blobName': blobName,
					'onDemand': true,
					'req' : req,
					'res' : res,
					'attemptsLeft' : config.numberOfAttempts
				};
				// if this file is NOT (already in queue to be downloaded, or is currently downloading)
				if(!(u.some(downloadQueue,compareBlobs,dqInfo) || u.some(downloadsRunning,compareBlobs,dqInfo))) {
					// then add the file to the queue
					downloadQueue.push(dqInfo);
					logger.verbose("Added on-demand download request for "+blobContainerName+"/.../"+u.last(blobName.split('/')));
					if(!config.onDemandRedirectToAzure) {
						res.send(404,"Not Found; Queued for download");
					} else {
						deferredToAzure = true;
					}
				} else {
					// if the download is already in queue, just send a 404 because we don't have the content yet
					// the client will fall back to getting the piece from azure anyway
					res.send(404,"Not Found; In queue for download but not ready yet");
				}
			}
			// some other error, aside from the file not existing (more serious)
			else if(error) {
				logger.error("Error sending file %s",req.path,error);
				res.send(500, "Problem transferring requested file");
			}
			// otherwise the file was sent fine
			else {
				// do nothing, the file has already been sent.
			}
			if(!deferredToAzure) logWebRequest(req,res);
		});
	});
    app.listen(config.port);
}

/* Get a handle to the Azure blob service */
function getBlobService() {
    var connectionString;
    var retryOperations = new azure.ExponentialRetryPolicyFilter(config.exponentialRetry.retryCount,
        config.exponentialRetry.retryInterval,
        config.exponentialRetry.minRetryInterval,
        config.exponentialRetry.maxRetryInterval);
    connectionString = "DefaultEndpointsProtocol=https;AccountName=" + config.storageAccountName + ";AccountKey=" + config.storageAccountSecret;
    return azure.createBlobService(connectionString).withFilter(retryOperations);
}

// Calculate the base64 encoded MD5 hash of the file given (for validation against azure)
function md5(filename) {
  var sum = crypto.createHash('md5');
  sum.update(fs.readFileSync(filename));
  return sum.digest('base64');
}

// Continuous processing of the download queue
function downloadNextBlob() {
	// queue the next download check call
	setImmediate(downloadNextBlob);
    var downloadComplete, downloadInfo, restartDownload, tempFilename;
    if (downloadQueue.length > 0 && downloadsRunning.length < config.concurrentDownloads) {
        downloadInfo = downloadQueue.shift();
        downloadsRunning.push(downloadInfo);
		// define callbacks for the various cases resulting from downloading this blob
        downloadComplete = function () {
			downloadQueueSize -= downloadInfo.size;
            downloadsRunning = u.filter(downloadsRunning,compareBlobsN,downloadInfo);
			// when the download queue has been emptied, we are no longer syncing content
			if(contentSyncActive && downloadQueue.length < 1) {
				logger.info("Content sync is complete");
				contentSyncActive = false;
			}
        };
        restartDownload = function () {
			downloadInfo.attemptsLeft--;
			if(downloadInfo.attemptsLeft > 0 || config.numberOfAttempts == 0) {
				downloadQueue.push(downloadInfo);
			} else {
				logger.warn("Number of retries for blob "+downloadInfo.blobContainerName+"/"+downloadInfo.blobName+" has been exceeded; dropping it from the queue.");
			}
			return downloadComplete();
        };
		// Get a temporary path into which we can download our blob
        tempFilename = temp.path();
        blobService = getBlobService();
        return blobService.getBlobProperties(downloadInfo.blobContainerName, downloadInfo.blobName, function (error, blobProperties, response) {
            var blobUrl, r, sharedAccessPolicy, startedAt, tempStream;
            if (error) {
                logger.error("getting blob properties for "+downloadInfo.blobContainerName+"/"+downloadInfo.blobName+": " + error, {
					noSeer: true,
					onDemand: !u.isUndefined(downloadInfo.onDemand) && downloadInfo.onDemand
				});
				// if we encountered an error at this stage for an on-demand download, it's probably a malicious or malformed request. We do not want to
				// reschedule it so we just send a 404 and call it complete
				// this only needs to be done when 'redirect to azure' is turned on because otherwise we would've sent a 404 already
                if(downloadInfo.onDemand && config.onDemandRedirectToAzure) {
					delete downloadInfo.onDemand;
					downloadInfo.res.send(404,"Not Found; On-Demand Failed");
				}
				return restartDownload();
            }
			else {
				// fetch the URL to the blob as per the access policy
                sharedAccessPolicy = {
                    AccessPolicy: {
                        Permissions: azure.Constants.BlobConstants.SharedAccessPermissions.READ,
                        Expiry: azure.date.minutesFromNow(6000)
                    }
                };
                blobUrl = blobService.getBlobUrl(downloadInfo.blobContainerName, downloadInfo.blobName, sharedAccessPolicy);
				// if on-demand download, redirect the client to the azure URL
				if(downloadInfo.onDemand && config.onDemandRedirectToAzure) {
					downloadInfo.res.redirect(blobUrl);
					logWebRequest(downloadInfo.req,downloadInfo.res);
				}
				// begin the download for this blob into the temporary directory
				logger.verbose("downloading " + blobUrl + " (" + blobProperties.contentLength + ") to " + tempFilename);
                tempStream = fs.createWriteStream(tempFilename);
                startedAt = (new Date()).getTime();
                r = request({
                    url: blobUrl,
                    timeout: 10 * 1000
                });
                r.pipe(tempStream);
                r.on('error', function (error) {
                    logger.error("request error: " + error, {
                        noSeer: true
                    });
                    tempStream.close();
                    fs.unlink(tempFilename);
                    return restartDownload();
                });
                return r.on('end', function () {
                    var finishedAt = (new Date()).getTime()
					  , elapsedTimeInSeconds = ((finishedAt-startedAt)/1000).toFixed(3);
					lastAzureDownloadSpeed = blobProperties.contentLength/elapsedTimeInSeconds;
                    return fs.exists(tempFilename, function (exists) {
                        if (!exists) {
                            logger.error("downloaded file not found");
                            return restartDownload();
                        } else {
							// if the file doesn't have an associated MD5 hash from Azure against which to validate, we must fall back to validating via the filesize
							if (!blobProperties.contentMD5) {
								logger.warn("File doesn't have an md5 hash to verify.  Falling back to size check.", {
									noSeer: true
								});
								fs.stat(tempFilename, function (error, stats) {
									if (!stats || parseInt(stats.size) !== parseInt(blobProperties.contentLength)) {
										if (stats) {
											logger.error("file wrong size: " + (parseInt(stats.size)) + " / " + (parseInt(blobProperties.contentLength)), {
												noSeer: true
											});
										}
										return fs.unlink(tempFilename);
									} else {
										// validation succeeded via file size, move the file into its final destination on disk
										logger.info("Download complete and verified by size. " + downloadInfo.destinationFilename + " in " + elapsedTimeInSeconds + "s");
										mkdirp(path.dirname(downloadInfo.destinationFilename));
										mv(tempFilename, downloadInfo.destinationFilename, {mkdirp: true}, function (error) {
											if (error) {
												logger.error("renaming file: " + error, {
													verb: 'content-sync'
												});
												restartDownload();
											}
										});
									}
								});
							}
							else {
								// now that the file has been downloaded, we need to validate its hash
								var hash = md5(tempFilename);
								if (hash !== blobProperties.contentMD5) {
									// if the validation of the MD5 hash fails, delete the local copy and log an error
									logger.error("Hash mismatch.  Downloaded file had md5 hash: " + hash + " but expected hash was: " + blobProperties.contentMD5, {
										noSeer: true
									});
									logger.error("File downloaded from: " + blobUrl + " appears to be corrupted based on md5 check.  Deleting downloaded file.", {
										verb: 'content-sync'
									});
									fs.unlink(tempFilename);
								} else {
									// validation succeeded via MD5, move the file to its final destination on disk
									logger.info("Download complete and verified with md5. " + downloadInfo.destinationFilename + " in " + elapsedTimeInSeconds + "s");
									mkdirp(path.dirname(downloadInfo.destinationFilename));
									mv(tempFilename, downloadInfo.destinationFilename, {mkdirp: true}, function (error) {
										if (error) {
											logger.error("renaming file: " + error, {
												verb: 'content-sync'
											});
											restartDownload();
										}
									});
								}
							}
							// callback to let the application know this file is done downloading
							downloadComplete();
                        }
                    });
                });
            }
        });
    }
};

// For a given container, downloads all blobs contained therein
function getBlobs(blobService, blobContainer) {
	// skip the excluded containers, do not download them
	if (blobContainer.name.match(config.excludeContainerPattern)) {
		return;
	}
	var localContainerDirectory = path.join(contentDirectory, blobContainer.name);
	logger.verbose("Processing blobs for container: " + blobContainer.name);
	
	// define a function that will process our blobs
	/* It is necessary to declare a local function here because we ideally want to pass processBlobs as the callback to
	 * getNextPage() and listBlobs() - however, being called back from those we lose scope to the 'localContainerDirectory'
	 * variable if this is not a locally declared function. */
	function processBlobs (error, blobs, continuation) {
		if (error) {
			logger.error("listing blobs in container: " + error, {
				verb: 'content-sync'
			});
		}
		if(blobs === null) {
			return;
		}
		var blob;
		for (var i = 0; i < blobs.length; i++) {
			blob = blobs[i];
			localBlobFilename = path.join(localContainerDirectory, blob.name);
			if(!fs.existsSync(localBlobFilename)) {
				var newDownload = {
					'destinationFilename': localBlobFilename,
					'blobContainerName': blobContainer.name,
					'blobName': blob.name,
					'size' : parseInt(blob.properties['content-length']) || 0,
					'attemptsLeft' : config.numberOfAttempts
				};
				downloadQueueSize += newDownload.size;
				downloadQueue.push(newDownload);
			}
		}
		// continue going through the next page, if there is one
		if (continuation.hasNextPage()) {
			continuation.getNextPage(processBlobs);
		}
	};
	
	// create our local container directory and begin processing the blobs for this container
	return mkdirp(localContainerDirectory, function (error) {
		if (error) {
			logger.error("creating local blob folder: " + error, {
				verb: 'content-sync'
			});
		}
        var prefixContentSet = { 'prefix': identifiedContentSet };
		return blobService.listBlobs(blobContainer.name, prefixContentSet, processBlobs);
	});
};

// The main entry point for performing a full content sync from azure to the local machine
function syncPackages() {
	var blobService = getBlobService();
	// only run sync when there are no active NON-ON-DEMAND downloads
	var nonOnDemandDownloads = u.filter(downloadQueue,function(x) { return !x.onDemand }).length;
    if (!nonOnDemandDownloads.length && (config.syncHours.length === 0 || config.syncHours.indexOf((new Date()).getHours()) > -1)) {
        logger.info('Starting content synchronization');
        return blobService.listContainers(function (error, blobContainers, nextMarker) {
            var blobContainer, results;
            if (error) {
                return logger.error("listing containers: " + error, {
                    verb: 'content-sync'
                });
            }
			// mark content sync as being active; thereby making content downloads unavailable
			contentSyncActive = true;
            /* Filter out containers to be included before further processing for blobs in each container */
            var includeContainers = u.filter(blobContainers, function(item) {
                    return this.keys.indexOf(item.name) > -1;
                }, { "keys": config.includeDirectories }
            );
            for (var i = 0; i < includeContainers.length; i++) {
                getBlobs(blobService, includeContainers[i]);
            }
        });
    }
};

// The main entry point for starting the zeroconf (bonjour) broadcast
function startBroadcast() {
	var bonjourServiceType = '_ccsoc-'+config.environmentIdentifier.toLowerCase()+'._tcp';
	logger.info("Starting zeroconf (bonjour) broadcast for service "+bonjourServiceType);
	// dns-sd is part of the Apple Bonjour SDK (available for windows and mac)
	// the -R option registers a service
	// dns-sd -R <Name> <Type> <Domain> <Port> [<TXT>...] (Register a service)
	var txtRecord;
	if(config.broadcastDetails) {
		txtRecord = [
			"VERSION="+packageinfo.version,
			"OS_TYPE="+os.type(),
			"OS_PLATFORM="+os.platform(),
			"OS_ARCH="+os.arch()
		].join(" ");
	} else {
		txtRecord = "";
	}
	exec('dns-sd -R "CCSoC Cache Server" '+bonjourServiceType+' local '+config.port + " "+txtRecord, function(error, stdout, stderr) {
		logger.error("Zeroconf (bonjour) stopped; will attempt to restart it after a brief timeout", {out: stdout, err: stderr});
		// try to restart the broadcast in a little while if it stops for any reason
		setTimeout(startBroadcast,10000);
	});
}

/* Start the application */
logger.info("CCSoC Caching Server %s starting...",packageinfo.version);
process.title = 'Pearson Caching Service';

//Create a placeholder to store config code files
var configCodeDir = config.configCodeSettings.relativeLocalPath;
try {
    mkdirp.sync(configCodeDir, 0755);
} catch(err) {
    logger.error("CRITICAL: Failed to create config code directory: " + err);
    process.exit(1);
}

var configCodeFile = '';
async.series([
    function(callback) {
        configCodeService.getConfigCodeDetails(config.environmentIdentifier,
            path.join(__dirname , configCodeDir),
            function(err, result) {
                if (err) {
                    return callback(err);
                } else {
                    configCodeFile = result;
                    callback(null);
                }
            });
    },
    function(callback) {
        configCodeService.getContentSetFromConfigCodeFile(configCodeFile, function(err, result) {
            if (err) {
                return callback(err);
            } else {
                identifiedContentSet = result;
                callback(null);
            }
        });
    }
], function (ccError) {
    if (ccError) {
        logger.error("CRITICAL: Failed to retrieve config code settings and/or content set: " + ccError);
        process.exit(-1);
    } else {
        // Create the content directory
        mkdirp(contentDirectory, function(error) {
            if (error) {
                logger.error("CRITICAL: Failed to create content directory: " + error);
                process.exit(-1);
            }
            // Start listening for client requests
            startWebServer();
            // Enable syncing if config allows it
            if (config.syncInterval > 0) {
                syncPackages();
                setInterval(syncPackages, config.syncInterval);
            } else {
                logger.warn("Not starting sync process because of config flag");
            }
            // start processing the download queue
            setImmediate(downloadNextBlob);
            // Start broadcasting zeroconf signal if enabled in config
            if (config.enableBroadcast) {
                startBroadcast();
            } else {
                logger.warn("Not starting zeroconf broadcast because of config flag");
            }
        });
    }
});