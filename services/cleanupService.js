'use strict';

var fs = require('fs'),
    path = require('path'),


//  traverseDirectory :  This function traverses drectory path to determine what to keep and what should be deleted.
var traverseDirectory = function (dir, done) {
    var results = [];
    fs.readdir(dir, function (err, list) {
        if (err) return done(err);
        var pending = list.length;
        if (!pending) return done(null, results);
        list.forEach(function (file) {
            file = path.resolve(dir, file);
            fs.stat(file, function (err, stat) {
                if (stat && stat.isDirectory()) {

                    traverseDirectory(file, function (err, res) {
                        results = results.concat(res);
                        if (!--pending) done(null, results);
                    });
                    var foldername = path.basename(file);

                    var canKeep = false;

                    for (var i = 0 ; i < maincontentFolders.length; i++) {
                        if (foldername.match(maincontentFolders[i]) && (foldername.length == maincontentFolders[i].length)) {
                            logger.verbose(i + "  Skipping the foldername ='" + foldername + "' the file name = '" + file + "'");
                            canKeep = true;
                        }
                    }

                    for (var i = 0 ; i < gradeSpecificContentFolders.length; i++) {
                        if (file.match(gradeSpecificContentFolders[i]) && (file.length == gradeSpecificContentFolders[i].length)) {
                            logger.verbose(i + "  Skipping the foldername ='" + foldername + "' the file name = '" + file + "'");
                            canKeep = true;
                        }
                    }

                    if (!canKeep) {
                        logger.verbose("Deleting the foldername ='" + foldername + "' the file name = '" + file + "'");
                        deleteFolderRecursive(file);
                    }
                }
            });
        });
    });
};
