var config = require(__dirname + '/config.js')
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
  , contentDirectory = path.join(__dirname, "content");

/* Global variables */
var downloadsRunning = 0
  , downloadQueue = [];
  
/* Configures and starts the web server for hosting content */
// Example URL: http://localhost:8888/half/00000000-0000-0000-0000-000000000000/grade10-ela-mastercontent/grade10_ela_unit5_lesson7_task3_step1.html
function startWebServer() {
	// TODO Implement the key functionality of this logger
	app.use(function(req, res, next){
		//logger.format('ccsoc', ':success :remote-addr - :method :url :status :res[content-length] bytes - :response-time ms - :bandwidth kbps');
		logger.info('%s %s - %s %s %s %s bytes - %s ms - %s kbps', '[SUCCESS]', req.ip, req.method, req.url, '[STATUS]', '[RES-CNT-LEN]', '[RES-TIME]', '[BNDWIDTH]' );
		next();
	});
	// health check functionality
    app.get('/', function (req, res) {
        res.send({
			'status': 'OK',
			'downloadQueueSize': downloadQueue.length,
			'downloadsRunning': downloadsRunning
		});
    });
	app.use('/', express.static(contentDirectory));
	// handle 404's
	app.use(function(req, res) {
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
		// the rest of the path is the blob name
		var blobName = pathArray.join("/");
		downloadQueue.push({
			'destinationFilename': path.join(contentDirectory,blobContainerName,blobName),
			'blobContainerName': blobContainerName,
			'blobName': blobName,
			'onDemand': true,
			'req' : req,
			'res' : res
		});
		logger.info("Added on-demand download request for "+blobContainerName+"/"+blobName);
		// TODO Ensure that the on-demand download doesn't already exist in the queue for another user
		// TODO Possibly instead of doing the redirect later, do the redirect instantly but to the azure server directly
	});
    app.listen(config.port);
}

/* Functions related to Azure (specifically blob storage) */
function getBlobService() {
    var connectionString;
    connectionString = "DefaultEndpointsProtocol=https;AccountName=" + config.storageAccountName + ";AccountKey=" + config.storageAccountSecret;
    return azure.createBlobService(connectionString).withFilter(new azure.ExponentialRetryPolicyFilter());
}

function md5(filename) {
  var sum = crypto.createHash('md5');
  sum.update(fs.readFileSync(filename));
  return sum.digest('base64');
}

function downloadNextBlob() {
	// queue the next download check call
	setImmediate(downloadNextBlob);
    var downloadComplete, downloadInfo, restartDownload, tempFilename;
    if (downloadQueue.length > 0 && downloadsRunning < config.concurrentDownloads) {
        downloadInfo = downloadQueue.shift();
        downloadsRunning += 1;
        downloadComplete = function () {
            downloadsRunning -= 1;
			if(downloadInfo.onDemand) {
				downloadInfo.res.redirect(downloadInfo.req.path);
			}
            return downloadNextBlob();
        };
        restartDownload = function () {
			if(downloadInfo.onDemand) {
				downloadInfo.res.send(404,"Not Found; On-Demand Failed");
				delete downloadInfo.onDemand;
				delete downloadInfo.req;
				delete downloadInfo.res;
			}
            downloadQueue.push(downloadInfo);
            return downloadComplete();
        };
        tempFilename = temp.path();
        blobService = getBlobService();
        return blobService.getBlobProperties(downloadInfo.blobContainerName, downloadInfo.blobName, function (error, blobProperties, response) {
            var blobUrl, r, sharedAccessPolicy, startedAt, tempStream;
            if (error) {
                restartDownload();
                if (error) {
                    return logger.error("getting blob properties for "+downloadInfo.blobContainerName+"/"+downloadInfo.blobName+": " + error, {
                        noSeer: true
                    });
                }
            }
			else {
                logger.info("downloading: " + downloadInfo.blobContainerName + "/" + downloadInfo.blobName + " (" + blobProperties.contentLength + ") to " + tempFilename);
                sharedAccessPolicy = {
                    AccessPolicy: {
                        Permissions: azure.Constants.BlobConstants.SharedAccessPermissions.READ,
                        Expiry: azure.date.minutesFromNow(6000)
                    }
                };
                blobUrl = blobService.getBlobUrl(downloadInfo.blobContainerName, downloadInfo.blobName, sharedAccessPolicy);
                logger.info("url: " + blobUrl);
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
                    var finishedAt;
                    finishedAt = (new Date()).getTime();
                    return fs.exists(tempFilename, function (exists) {
                        if (!exists) {
                            logger.error("downloaded file not found");
                            return restartDownload();
                        } else {
                            var hash = md5(tempFilename);
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
										logger.info("Size check of  " + downloadInfo.destinationFilename + " passed.");
										logger.info("Download complete and verified by size. " + downloadInfo.destinationFilename + " in " + ((finishedAt - startedAt) / 1000) + "s");
										mkdirp(path.dirname(downloadInfo.destinationFilename));
										return fs.rename(tempFilename, downloadInfo.destinationFilename, function (error) {
											if (error) {
												logger.error("renaming file: " + error);
												return restartDownload();
											}
										});
									}
								});
							}
							else if (hash !== blobProperties.contentMD5) {
								logger.error("Hash mismatch.  Downloaded file had md5 hash: " + hash + " but expected hash was: " + blobProperties.contentMD5, {
									noSeer: true
								});
								logger.error("File downloaded from: " + blobUrl + " appears to be corrupted based on md5 check.  Deleting downloaded file.", {
									verb: 'content-sync'
								});
								fs.unlink(tempFilename);
							} else {
								logger.info("Download complete and verified with md5. " + downloadInfo.destinationFilename + " in " + ((finishedAt - startedAt) / 1000) + "s");
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
							downloadComplete();
							return logger.info("current downloads: " + downloadsRunning);
                        }
                    });
                });
            }
        });
    }
};

function getBlobs(blobService, blobContainer) {
	// skip the excluded containers, do not download them
	if (blobContainer.name.match(config.excludeContainerPattern)) {
		return;
	}
	var localContainerDirectory = path.join(contentDirectory, blobContainer.name);
	logger.info("Processing blobs for container: " + blobContainer.name);
	
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
					'blobName': blob.name
				};
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
		return blobService.listBlobs(blobContainer.name, processBlobs);
	});
};

function syncPackages() {
	// TODO Disable content serving while sync is running; log this request and send the following
	/*
		response.writeHead(404, {
			'Content-Length': Buffer.byteLength("Requests not served during content synch"),
			'Content-Type': 'text/plain'
		  });
	*/
	var blobService = getBlobService();
    if (!downloadsRunning.length && !downloadQueue.length && (config.syncHours.length === 0 || config.syncHours.indexOf((new Date()).getHours()) > -1)) {
        logger.info('running syncPackages');
        return blobService.listContainers(function (error, blobContainers, nextMarker) {
            var blobContainer, results;
            if (error) {
                logger.error("listing containers: " + error, {
                    verb: 'content-sync'
                });
            }
			for(var i=0;i < blobContainers.length; i++) {
				getBlobs(blobService, blobContainers[i]);
			}
        });
    }
};

function startBroadcast() {
	var bonjourServiceType = '_ccsoc-'+config.environmentIdentifier.toLowerCase()+'._tcp';
	logger.info("Starting bonjour broadcast for service "+bonjourServiceType);
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
		logger.error("dns-sd (bonjour) stopped; ", {out: stdout, err: stderr});
		// try to restart the broadcast in a little while if it stops for any reason
		setTimeout(startBroadcast,10000);
	});
}

/* Start the application */
mkdirp(contentDirectory, function (error) {
    if (error) {
		logger.error("CRITICAL: Failed to create content directory: "+error);
		process.exit(-1);
	}
    startWebServer();
	if(config.syncInterval > 0) {
		syncPackages();
		setInterval(syncPackages,config.syncInterval);
	}
	else logger.info("Not starting sync process because of config flag");
	// start processing the download queue
	setImmediate(downloadNextBlob);
	startBroadcast();
	logger.info("CCSoC Cache Server started!");
});