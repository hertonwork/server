

'use strict';

const fs = require('fs');
const path = require('path');

class SimpleServerHelper {
    constructor(config, request, response) {
        this.settings = {
            ...{
                publicFolder: 'public',
                htmlIndexPath: 'public/index.html',
                html404Path: 'public/404.html',
                verbose: false,
                allowedFiles: {
                    txt: 'text/plain',
                    json: 'text/json',
                    css: 'text/css',
                    gif: 'image/gif',
                    jpg: 'image/jpeg',
                    png: 'image/png',
                    svg: 'image/svg+xml',
                    ico: 'image/ico',
                    js: 'application/javascript',
                    html: 'text/html',
                },
            },
            ...config
        };
        this.request = request;
        this.response = response;
        const uri = request.url.toLowerCase();
        const publicPath = path.join(__dirname, this.settings.publicFolder);
        this.mimeType = this.getType(uri);
        this.filePath = this.isHtml() ? this.settings.htmlIndexPath : publicPath + uri;
    }

    getType(path) {
        if (path == '/') return this.settings.allowedFiles['html'];
        const extension = path.split('.').pop().split('?').shift();
        return this.settings.allowedFiles[extension];
    }

    isHtml() {
        return this.mimeType == this.settings.allowedFiles['html'];
    }

    isValid() {
        return this.isHtml() || this.fileExist();
    }

    fileExist() {
        let exists = false
        try {
            exists = fs.existsSync(this.filePath);
        } catch (error) {
            if (this.settings.verbose) console.error(error);
        }
        return exists;
    }

    handleLogs(isValid) {
        if (this.settings.verbose) {
            if (isValid) console.info(new Date().toString() + ' ' + this.filePath);
            else console.error('Error accessing ' + this.request.url);
        }
    }

    writeHead(isValid) {
        if (isValid) {
            this.response.writeHead(200, {
                'Cache-Control': 'max-age=31536000',
                'Content-Type': this.mimeType
            });
        } else {            
            this.response.writeHead(404, {
                'Content-Type': this.settings.allowedFiles['html']
            });
        }
    }

    respond() {
        const isValid = this.isValid();
        this.writeHead(isValid);
        isValid ? fs.createReadStream(this.filePath).pipe(this.response)
                : fs.createReadStream(this.settings.html404Path).pipe(this.response);
        this.handleLogs(isValid);
    }
};

module.exports = {
    SimpleServerHelper
};