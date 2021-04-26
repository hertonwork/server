const http = require('http');
const fs = require('fs');
const port = 2222;
const path = require('path');
const public = path.join(__dirname, 'public');
const htmlFile = 'public/index.html'; //Single page app file
/* Allowed file types */
const types = {
    txt: 'text/plain',
    json: 'text/json',
    css: 'text/css',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    ico: 'image/ico',
    js: 'application/javascript'
};
/* Simple media path validation for single page app */
function getType(path) {
    if (path == '/' || path.indexOf(`.html`) != -1) return 'html';
    for (const type in types) {
        if (path.indexOf(`.${type}`) != -1) return type;
    }
    return false;
}
/* Server rules */
const server = http.createServer((req, res) => {
    const path = req.url.toLowerCase();
    const mediaType = getType(path);
    if (! mediaType) res.writeHead(404).end('Not found');
    res.writeHead(200, {
        'Cache-Control': 'max-age=31536000',
        'Content-Type': mediaType == 'html' ? 'text/html' : types[mediaType]
    });
    const filePath = mediaType == 'html' ? htmlFile : public + path;
    res.end(fs.readFileSync(filePath));
});

server.listen(port, '127.0.0.1');
console.info(`Server running on port ${port}`)