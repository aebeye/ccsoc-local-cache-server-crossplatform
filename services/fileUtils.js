'use strict';

var fs = require('fs'),
    crypto = require('crypto');

/* Calculate the base64 encoded MD5 hash of the file given (for validation against azure) */
exports.md5 = function md5(filename) {
    var sum = crypto.createHash('md5');
    sum.update(fs.readFileSync(filename));
    return sum.digest('base64');
}

// convert number of bytes into a more human readable format
exports.readableFileSize = function humanFileSize(bytes, si) {
    var thresh = si ? 1000 : 1024;
    if (bytes < thresh) return bytes + ' B';
    var units = si ? ['kB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'] : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    var u = -1;
    do {
        bytes /= thresh;
        ++u;
    } while(bytes >= thresh);
    return bytes.toFixed(1) + ' ' + units[u];
};