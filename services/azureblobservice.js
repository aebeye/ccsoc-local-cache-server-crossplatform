'use strict';

var azure = require('azure'),
    config = require('../config'),
    logger = require('../logger.js');

/* Get a handle to the Azure blob service */
exports.blobService = function getBlobService(storageAccountName, storageAccountSecret) {
    var connectionString;
    var retryOperations = new azure.ExponentialRetryPolicyFilter(config.exponentialRetry.retryCount,
        config.exponentialRetry.retryInterval,
        config.exponentialRetry.minRetryInterval,
        config.exponentialRetry.maxRetryInterval);
    connectionString = "DefaultEndpointsProtocol=https;AccountName=" + storageAccountName + ";AccountKey=" + storageAccountSecret;
    logger.info("Connecting to Azure Blob Service with storage name:  " + storageAccountName);
    return azure.createBlobService(connectionString).withFilter(retryOperations);
}