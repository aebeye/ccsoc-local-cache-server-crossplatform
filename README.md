# CCSoC Cache Service (Cross Platform)
This is a remake of the ccsoc-local-cache-server project to be cross platform, notably to support being run on a Microsoft Windows environment.

The caching server is an application where the goal is to run it on a school network in a school that is using the Pearson app. The application will send out a zeroconf broadcast over the network to signal its availability.
Pearson app clients will connect to the server instead of going to the content store in Azure blob storage directly and request content from the caching server instead. The caching server will either have this content
available from a previous content sync, or will fetch it on demand and send it through to the client. The ultimate goal is to drastically reduce the load on the Azure blob storage servers and decrease wait times for
the app users.

This version of the caching server supports the following operating systems:

* OS X
* Windows 8

## Running on Windows
This project has been only tested with **Windows 8**. Other versions of Windows may work, but are not guaranteed to. To get the project running you will need to:

1. Install Apple's Bonjour SDK for Windows 2.0.4 (included in this package in the support folder) which will provide the required 'dns-sd' command to broadcast the Bonjour signal.
2. Install Node.JS (tested on v0.10.24)
3. Navigate to the project directory and run 'npm install' to download all required modules
4. Run the project using 'node index.js'

## Running on a Mac
This documentation has yet to be created. *The steps should be more or less the same as for windows however.*

## How to test it out
You can test if the system works by browsing to http://localhost:8888/half/00000000-0000-0000-0000-000000000000/grade10-ela-mastercontent/grade10_ela_unit5_lesson7_task3_step1.html 
which should fetch the content from azure if the on-demand option is enabled in the config file. After the content has been downloaded, it will be accessible to clients. Please double 
check the config file to make sure all the options are set properly to your testing requirements before attempting to test it out.

## Important directories
The app will automatically create a $approot/log directory for logs and a $approot/content directory for all downloaded content from Azure. 

# Technical Details
The caching server has several main pieces, as well as a few minor ones.

* The **Azure** piece is required to download the actual content files (images, html, zip files, epubs, etc.) which are stored in Azure blob storage to the local machine.
* The related **content sync** piece is configurable and allows one to schedule a full sync with Azure on an interval
* The **web server** piece serves the files via HTTP to the local network; this is accomplished via the express middleware
* The **broadcast** piece uses Apple's Bonjour SDK to send a zeroconf broadcast to the local network about the availability of the caching server to the various app users

## Interaction with the tablet app
The behavior the app uses is as follows:

* The check (listening for broadcast) for the availability of the caching server occurs constantly, at all points of the app's operation
* If a request to the caching server fails for whatever reason the app will automatically attempt to get the content from Azure directly (e.g. sending a 404 from the caching server will not affect how the app looks) 

## Extra Features (not available in original)

* Compatibility with Microsoft Windows
* **On-demand downloads** allow the caching server to function without having performed a full sync of content with Azure. It works by waiting for client requests as usual, but if a request
 cannot be satisfied due to a missing file then the caching server will go and fetch that file from Azure.
* Healthcheck functionality on the web server

## To-Do List (Features yet to be ported)
Maintaining this project is a continued effort, and there are some features from the old implementation that have not yet been ported over.

* The ability to self-update and restart
* 'Forever' running of the application, restarting itself if it crashes
* Send a heartbeat signal to the Seer logger
* Testing of the Seer logger to ensure it works on the receiving side

## Caveats and Potential Issues

* The logging of requests for files only happens when a file was actually sent; if for whatever reason a cache was involved on the user side (such as when testing with a browser) 
and the user already has the file downloaded, a 304 "Not Modified" response will be sent and this does not trigger the logging functionality. It will *still log successful and/or 
error requests* however.