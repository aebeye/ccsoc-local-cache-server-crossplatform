# CCSoC Cache Service (Cross Platform)
This is a remake of the ccsoc-local-cache-server project to be cross platform, notably to support being run on a Microsoft Windows environment.

This version supports the following operating systems:
* OS X
* Windows 8

# Running on a Mac
This documentation has yet to be created.

# Running on Windows
This project has been only tested with **Windows 8**. Other versions of Windows may work, but are not guaranteed to. To get the project running you will need to:
* Install Apple's Bonjour SDK for Windows 2.0.4 (included in this package in the support folder) which will provide the required 'dns-sd' command to broadcast the Bonjour signal.
* Install Node.JS (tested on v0.10.24)
* Navigate to the project directory and run 'npm install' to download all required modules
* Run the project using 'node index.js'

# To-Do List (Features yet to be ported)
Maintaining this project is a continued effort, and there are some features from the old implementation that have not yet been ported over.
* The ability to self-update and restart
* 'Forever' running of the application, restarting itself if it crashes
* Send a heartbeat signal to the Seer logger
* Testing of the Seer logger to ensure it works on the receiving side