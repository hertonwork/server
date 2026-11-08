#!/usr/bin/env node
// The command line: `npm start` in this repository, or `npx @labs_kai/server [folder]` anywhere.
//
//   npx @labs_kai/server dist --port 8080
//
// Flags win over environment variables, which win over the defaults:
//
//   [folder]            PUBLIC_DIR   ./public if it exists, else the current folder
//   -p, --port <n>      PORT         2211 (0 picks a free port; the line printed at start says which)
//   --host <address>    HOST         127.0.0.1; 0.0.0.0 in a container or to reach it from another machine
//   --mcp               MCP=1        answer MCP clients (coding agents) at /mcp
//   -v, --verbose       VERBOSE=1    log one line per request
//                       TLS_KEY / TLS_CERT   a key and certificate; when both exist the server speaks HTTPS.
//                                    Defaults to ./key.pem and ./cert.pem when present (`npm run cert` makes a pair).
//                                    Behind nginx or Caddy leave them out: the proxy terminates TLS.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from './lib/simple-server.js';

const env = process.env;
const on = (v) => /^(1|true|yes)$/i.test(v || '');
const fail = (message) => { console.error(`server: ${message}`); process.exit(1); };

const help = `Usage: npx @labs_kai/server [folder] [options]

Serves a folder (default: ./public if it exists, else the current folder) at http://127.0.0.1:2211:
safe paths, brotli/gzip, caching, ETags, SPA fallback for extension-less paths, security headers.

  -p, --port <n>      port (env PORT, default 2211; 0 picks a free one)
      --host <addr>   bind address (env HOST, default 127.0.0.1; 0.0.0.0 to reach it from other machines)
      --mcp           answer MCP clients (coding agents) at /mcp (env MCP=1)
  -v, --verbose       log every request (env VERBOSE=1)
  -h, --help          this help
      --version       print the version

HTTPS: when key.pem and cert.pem (or TLS_KEY and TLS_CERT) exist, it speaks https.
https://github.com/hertonwork/server`;

// a dozen flags don't need a parser library
const args = process.argv.slice(2);
const flags = {}, positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  const value = () => { const v = args[++i]; if (v === undefined || v.startsWith('-')) fail(`${a} needs a value (see --help)`); return v; };
  if (a === '-h' || a === '--help') { console.log(help); process.exit(0); }
  else if (a === '--version') { console.log(JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version); process.exit(0); }
  else if (a === '-p' || a === '--port') flags.port = value();
  else if (a.startsWith('--port=')) flags.port = a.slice(7);
  else if (a === '--host') flags.host = value();
  else if (a.startsWith('--host=')) flags.host = a.slice(7);
  else if (a === '--mcp') flags.mcp = true;
  else if (a === '-v' || a === '--verbose') flags.verbose = true;
  else if (a.startsWith('-')) fail(`unknown option ${a} (see --help)`);
  else positional.push(a);
}
if (positional.length > 1) fail(`one folder at a time (got ${positional.join(', ')})`);

const rawPort = flags.port ?? env.PORT;
const port = rawPort === undefined || rawPort === '' ? 2211 : Number(rawPort);
if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`"${rawPort}" is not a port number`);
const host = flags.host || env.HOST || '127.0.0.1';
const publicDir = positional[0] || env.PUBLIC_DIR || (fs.existsSync('public') ? 'public' : '.');
const verbose = flags.verbose || on(env.VERBOSE);
const mcp = flags.mcp || on(env.MCP);

if (!fs.statSync(publicDir, { throwIfNoEntry: false })?.isDirectory()) fail(`"${publicDir}" is not a folder`);

const keyFile = env.TLS_KEY || 'key.pem';
const certFile = env.TLS_CERT || 'cert.pem';
const tls = fs.existsSync(keyFile) && fs.existsSync(certFile)
  ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
  : null;

const server = createServer({ publicDir, verbose, tls, mcp });

server.listen(port, host, () => {
  const shown = host.includes(':') ? `[${host}]` : host;
  const base = `${tls ? 'https' : 'http'}://${shown}:${server.address().port}`;
  const folder = path.relative(process.cwd(), path.resolve(publicDir)) || '.';
  console.info(`server  ${base}  serving ${folder.startsWith('..') ? path.resolve(publicDir) : './' + folder.replace(/^\.\/?/, '')}${verbose ? '  (verbose)' : ''}`);
  if (mcp) console.info(`mcp     ${base}/mcp  →  claude mcp add --transport http server ${base}/mcp`);
});

server.on('error', (err) => {
  fail(err.code === 'EADDRINUSE' ? `port ${port} is already in use (use --port or PORT)` : err.message);
});

// finish in-flight requests, then exit; a hard exit after 3 s if a client keeps a connection open
const shutdown = () => {
  server.close(() => process.exit(0));
  server.closeIdleConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
