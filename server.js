const http = require('https');
const fs = require('fs');
const options = {
    key: fs.readFileSync('key.pem'),
    cert: fs.readFileSync('cert.pem')
};
const { SimpleServerHelper } = require('./SimpleServerHelper.js');
const port = process.env.PORT || 2222;
const verbose = process.env.VERBOSE || false // To log errors and files accessed
const config = {
    publicFolder: 'public',
    htmlIndexPath: 'public/index.html',
    html404Path: 'public/404.html',
    verbose 
};

const server = http.createServer(options, (request, response) => {
    new SimpleServerHelper(config, request, response).respond();
});

server.listen(port, '127.0.0.1');
console.info(`Server running on port ${port}`)