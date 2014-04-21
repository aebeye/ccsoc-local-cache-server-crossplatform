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

# How to test it out
You can test if the system works by browsing to http://localhost:8888/half/00000000-0000-0000-0000-000000000000/grade10-ela-mastercontent/grade10_ela_unit5_lesson7_task3_step1.html which should fetch the content from azure if the on-demand option is enabled in the config file. After the content has been downloaded, it will be accessible to clients. Please double check the config file to make sure all the options are set properly to your testing requirements before attempting to test it out.

# To-Do List (Features yet to be ported)
Maintaining this project is a continued effort, and there are some features from the old implementation that have not yet been ported over.
* The ability to self-update and restart
* 'Forever' running of the application, restarting itself if it crashes
* Send a heartbeat signal to the Seer logger
* Testing of the Seer logger to ensure it works on the receiving side

# Caveats and Potential Issues
* The logging of requests for files only happens when a file was actually sent; if for whatever reason a cache was involved on the user side (such as when testing with a browser) and the user already has the file downloaded, a 304 "Not Modified" response will be sent and this does not trigger the logging functionality. It will *still log successful and/or error requests* however.