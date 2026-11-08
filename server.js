#!/usr/bin/env node
// Entry point: `npm start` (or `node server.js`). Everything is configured with environment variables:
//
//   PORT=2211          port to listen on
//   HOST=127.0.0.1     bind address; use 0.0.0.0 in a container or to reach it from another machine
//   PUBLIC_DIR=public  folder to serve
//   VERBOSE=1          log one line per request
//   MCP=1              answer MCP clients (coding agents) at /mcp: claude mcp add --transport http server http://127.0.0.1:2211/mcp
//   TLS_KEY / TLS_CERT paths to a key and certificate; when both exist the server speaks HTTPS.
//                      Defaults to ./key.pem and ./cert.pem when they are present (`npm run cert` makes a localhost pair).
//                      Behind nginx or Caddy leave them out: the proxy terminates TLS and this stays plain HTTP.
import fs from 'node:fs';
import { createServer } from './lib/simple-server.js';

const env = process.env;
const port = Number(env.PORT) || 2211;
const host = env.HOST || '127.0.0.1';
const publicDir = env.PUBLIC_DIR || 'public';
const on = (v) => /^(1|true|yes)$/i.test(v || '');
const verbose = on(env.VERBOSE);
const mcp = on(env.MCP);

const keyFile = env.TLS_KEY || 'key.pem';
const certFile = env.TLS_CERT || 'cert.pem';
const tls = fs.existsSync(keyFile) && fs.existsSync(certFile)
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : null;

if (!fs.existsSync(publicDir)) {
  console.error(`simple-server: "${publicDir}" does not exist (set PUBLIC_DIR to the folder you want to serve)`);
  process.exit(1);
}

const server = createServer({ publicDir, verbose, tls, mcp });

server.listen(port, host, () => {
  const base = `${tls ? 'https' : 'http'}://${host}:${port}`;
  console.info(`simple-server  ${base}  serving ./${publicDir}${verbose ? '  (verbose)' : ''}`);
  if (mcp) console.info(`mcp            ${base}/mcp  →  claude mcp add --transport http server ${base}/mcp`);
});

server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `simple-server: port ${port} is already in use (set PORT to another one)` : err.message);
  process.exit(1);
});

// finish in-flight requests, then exit; a hard exit after 3 s if a client keeps a connection open
const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
