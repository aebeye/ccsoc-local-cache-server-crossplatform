module.exports = {
	/* excludeContainerPattern (regex) : REQUIRED
	 * This sets the regular expression against which azure container names are tested. If the container name matches
	 * this pattern, the container is ignored for the purposes of syncing content. */
	"excludeContainerPattern" : /mastercontent$/,
	/* environmentIdentifier (string) : REQUIRED
	 * This is the environment identifier, also known as the 'config code'. This affects the type of bonjour service that
	 * is broadcast to the local network. The Pearson app will always look for the matching broadcast from the specified
	 * config code in the app, so ensure you are broadcasting the correct config code or else your app will not pick it up. */
	"environmentIdentifier" : "ccsocdct", // default/prod was d6z9r8
	/* Azure Connection Details : REQUIRED */
	"storageAccountName" : "ccsocwestrepo2",
	"storageAccountSecret" : "TXsXgfl8iBHMlTdC1oQlJz1zMY2ppVVULL88/f0ukzf6KZOJ60jQArP20xD4cZzYF9K5bTDAuCfupOgyJioHgQ==",
	/* port (int) : REQUIRED
	 * This is the TCP port on which the webserver will listen for incoming connections. */
	"port" : 8888,
	/* syncInterval (int) : REQUIRED
	 * This is the number of milliseconds between sync attempts for Azure content.
	 * A value of 0 disables sync */
	"syncInterval" : 0, // prod value is 1800000 (~20 days)
	/* syncHours ([int]) : REQUIRED
	 * This is the hours of the day (in 24 hour time; 0 being midnight) when to perform content syncs. If omitted or
	 * empty, the sync will not care what hour it is and continue anyway. */
	"syncHours" :[], // prod value is [7,8,9,10,11]
	/* concurrentDownloads (int > 0) : REQUIRED
	 * The maximum number of downloads from Azure that are allowed to happen simultaneously. This does *not* affect the
	 * number of users pulling content from the caching server. */
	"concurrentDownloads" : 4,
	/* Seer Service Details : REQUIRED */
	"useSeerLogger" : false, // In production set this to true
	"reportingUrl" : "https://seer-beacon.ecollege.com",
	"reportingAppId" : "commoncore",
	"reportingPassword" : "eiP93jd91lL",
	"heartbeatInterval": 10800000,
	/* logLevel (string) : REQUIRED
	 * The level of verbosity to log to disk. Possible values are info, warn, error, all */
	"logLevel": "info",
	"maximumLogFileSize": 10000000,
	"maximumLogFiles": 4,
	/* allowOnDemand (boolean) : REQUIRED
	 * If set to true, when a user requests content that the caching server does not have, the caching server will attempt
	 * to fetch that content from Azure in realtime and send it back to the user. This functionality is currently in BETA. */
	"allowOnDemand" : true,
	/* broadcastDetails (boolean) : REQUIRED
	 * The network broadcast for Bonjour (dns-sd) allows the ability to add a TXT record with additional details. Setting
	 * this to true will broadcast the server's caching software version, as well as what OS it is running on. */
	"enableBroadcast" : false,
	"broadcastDetails" : true
};