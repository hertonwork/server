// simple-server: a static server for a single-page app, with nothing to install.
//
//   import { createServer } from './lib/simple-server.js';
//   createServer({ publicDir: 'public' }).listen(2211);
//
// What it does, and why:
//   - resolves every path inside publicDir and refuses anything that escapes it (v1 served ../key.pem)
//   - hides dotfiles (.env, .git) except /.well-known/
//   - serves index.html for extension-less paths (/about, /users/42) so client-side routing works
//   - sends the right Content-Type with charset, an ETag and Last-Modified, answers 304 to conditional requests
//   - caches by type: HTML, the service worker and the manifest revalidate every time; assets for a day;
//     fingerprinted assets (app.3f9c2a1b.js) for a year
//   - compresses text with brotli or gzip when the client accepts it; honours Range requests for media
//   - sets the usual security headers; HSTS only when the connection is TLS
//   - never crashes on a bad path, a directory, or a file that vanished between stat and read
//   - lets you add JSON routes (`routes`) and ships GET /api/health
//   - with `mcp: true`, answers MCP clients (coding agents) at POST /mcp — see lib/mcp.js
import { createReadStream, readFileSync, promises as fs } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import zlib from 'node:zlib';
import { createMcp } from './mcp.js';

let version = '2';
try { version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version; } catch { /* used as a module without its package.json */ }

export const mimeTypes = {
  html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8', webmanifest: 'application/manifest+json; charset=utf-8', map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8', xml: 'application/xml; charset=utf-8', svg: 'image/svg+xml; charset=utf-8', md: 'text/markdown; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf', wasm: 'application/wasm', zip: 'application/zip',
};

const compressible = /^(text\/|application\/(json|manifest\+json|xml|javascript|wasm)|image\/svg)/;
const fingerprinted = /[.-][0-9a-f]{8,}\.\w+$/i;   // app.3f9c2a1b.js, styles-8d7e6f5a4b.css
const revalidate = new Set(['html', 'webmanifest']);  // plus sw.js: browsers must see new versions at once

export const defaults = {
  publicDir: 'public',
  index: 'index.html',
  notFound: '404.html',
  spa: true,                 // extension-less paths (not under /api/) get index.html with a 200
  dotfiles: false,           // serve files and folders whose name starts with a dot (/.well-known/ is always allowed)
  maxAge: 86400,             // seconds, for assets that are not fingerprinted
  compress: true,            // brotli / gzip for text types over 1 KB
  headers: {                 // merged over these defaults; set a key to null to drop it
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  },
  health: true,              // GET /api/health → { ok, started, uptime, requests, node }
  routes: {},                // { 'GET /api/thing': (req, res, url) => object | undefined }
  mcp: false,                // POST /mcp for coding agents (Streamable HTTP, read-only tools); see lib/mcp.js
  verbose: false,            // one line per request on `log`
  log: (line) => console.log(line),
};

const PLAIN = mimeTypes.txt;

/** Build the request handler. Exported on its own so it can sit behind your own http.createServer, or a test. */
export function createHandler(options = {}) {
  const cfg = { ...defaults, ...options, headers: { ...defaults.headers, ...(options.headers || {}) } };
  const root = path.resolve(cfg.publicDir);
  const started = new Date();
  let requests = 0;

  const health = () => ({
    ok: true, started: started.toISOString(), uptime: Math.round(process.uptime()), requests, node: process.version,
  });
  const routes = new Map(Object.entries(cfg.routes));
  if (cfg.health && !routes.has('GET /api/health')) routes.set('GET /api/health', health);

  const baseHeaders = (req) => {
    const h = {};
    for (const [k, v] of Object.entries(cfg.headers)) if (v != null) h[k] = v;
    if (req.socket.encrypted) h['Strict-Transport-Security'] = 'max-age=31536000';
    return h;
  };

  const send = (req, res, status, body, type = PLAIN, extra = {}) => {
    res.writeHead(status, { ...baseHeaders(req), 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), ...extra });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  // the file a URL path means, or null when it points outside publicDir or at a hidden dotfile
  const resolve = (pathname) => {
    const clean = path.posix.normalize('/' + pathname);
    if (!cfg.dotfiles && !clean.startsWith('/.well-known/') && clean.split('/').some((s) => s.length > 1 && s[0] === '.')) return null;
    const p = path.resolve(root, '.' + clean);
    return p === root || p.startsWith(root + path.sep) ? p : null;
  };

  const cacheControl = (file, ext) => {
    if (revalidate.has(ext) || file.endsWith(path.sep + 'sw.js')) return 'no-cache';
    if (fingerprinted.test(file)) return 'public, max-age=31536000, immutable';
    return `public, max-age=${cfg.maxAge}`;
  };

  const serveFile = async (req, res, file, status = 200) => {
    const stat = await fs.stat(file);
    if (stat.isDirectory()) throw Object.assign(new Error('is a directory'), { code: 'EISDIR' });
    if (!stat.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
    const ext = path.extname(file).slice(1).toLowerCase();
    const type = mimeTypes[ext] || 'application/octet-stream';
    const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const mtime = new Date(Math.floor(stat.mtimeMs / 1000) * 1000);
    const headers = {
      ...baseHeaders(req),
      'Content-Type': type,
      'Cache-Control': cacheControl(file, ext),
      'ETag': etag,
      'Last-Modified': mtime.toUTCString(),
      'Accept-Ranges': 'bytes',
    };
    if (status === 200) {
      const inm = req.headers['if-none-match'];
      const ims = req.headers['if-modified-since'];
      if (inm ? inm.split(',').some((t) => t.trim() === etag) : ims && new Date(ims) >= mtime) {
        res.writeHead(304, headers);
        return res.end();
      }
    }

    let encoding = null;
    if (cfg.compress && compressible.test(type) && stat.size > 1024) {
      const accept = String(req.headers['accept-encoding'] || '');
      encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
      headers['Vary'] = 'Accept-Encoding';
    }

    // a single byte range (what <video> and <audio> ask for); only when the body is not compressed
    let start = 0, end = stat.size - 1;
    const range = status === 200 && !encoding && req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range) {
      if (range[1] === '' && range[2] === '') return send(req, res, 416, 'Range Not Satisfiable', PLAIN, { 'Content-Range': `bytes */${stat.size}` });
      if (range[1] === '') start = Math.max(0, stat.size - Number(range[2]));
      else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
      if (start > end || start >= stat.size) return send(req, res, 416, 'Range Not Satisfiable', PLAIN, { 'Content-Range': `bytes */${stat.size}` });
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }

    if (encoding) headers['Content-Encoding'] = encoding;
    else headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();

    const stream = createReadStream(file, { start, end });
    stream.on('error', (err) => res.destroy(err));
    if (encoding === 'br') stream.pipe(zlib.createBrotliCompress({ params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })).pipe(res);
    else if (encoding === 'gzip') stream.pipe(zlib.createGzip({ level: 6 })).pipe(res);
    else stream.pipe(res);
  };

  const notFound = async (req, res) => {
    const page = resolve(cfg.notFound);
    if (page) { try { return await serveFile(req, res, page, 404); } catch { /* no 404 page: plain text */ } }
    send(req, res, 404, 'Not Found');
  };

  const handle = async function handle(req, res) {
    const t0 = process.hrtime.bigint();
    requests++;
    if (cfg.verbose) {
      res.on('finish', () => cfg.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Number(process.hrtime.bigint() - t0) / 1e6 | 0}ms`));
    }
    try {
      let url, pathname;
      try {
        // "//x" would parse as a protocol-relative URL with host "x"; it is just a path with a doubled slash
        url = new URL(req.url.replace(/^\/{2,}/, '/'), 'http://localhost');
        pathname = decodeURIComponent(url.pathname);
      } catch { return send(req, res, 400, 'Bad Request'); }
      if (pathname.includes('\0')) return send(req, res, 400, 'Bad Request');

      // routes first: 'GET /api/health' → object (sent as JSON), or the handler writes the response itself
      const route = routes.get(`${req.method === 'HEAD' ? 'GET' : req.method} ${pathname}`);
      if (route) {
        const out = await route(req, res, url);
        if (res.writableEnded || res.headersSent) return;
        return send(req, res, 200, JSON.stringify(out ?? {}), mimeTypes.json, { 'Cache-Control': 'no-store' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, 'Method Not Allowed', PLAIN, { Allow: 'GET, HEAD' });

      let file = resolve(pathname);
      if (!file) return notFound(req, res);
      if (pathname.endsWith('/')) file = path.join(file, cfg.index);
      try {
        return await serveFile(req, res, file);
      } catch (err) {
        if (err.code === 'EISDIR') {   // /docs → /docs/ so relative links inside it work
          return send(req, res, 301, '', PLAIN, { Location: `${url.pathname}/${url.search}` });
        }
        if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      }
      // an extension-less path that is not a file: the app shell, for client-side routing
      const accept = req.headers.accept;
      if (cfg.spa && !path.extname(pathname) && !pathname.startsWith('/api/') && (!accept || /text\/html|\*\/\*/.test(accept))) {
        const shell = resolve(cfg.index);
        if (shell) { try { return await serveFile(req, res, shell); } catch { /* no index.html */ } }
      }
      return notFound(req, res);
    } catch (err) {
      if (cfg.verbose) cfg.log(`${new Date().toISOString()} error ${req.method} ${req.url}: ${err.message}`);
      if (!res.headersSent) send(req, res, 500, 'Internal Server Error');
      else res.destroy();
    }
  };

  if (cfg.mcp) {
    const typeOf = (file) => mimeTypes[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
    routes.set('POST /mcp', createMcp({ root, resolve, typeOf, health, handle, version }));
    // stateless: no GET stream, no sessions to DELETE
    const only = (req, res) => { res.writeHead(405, { Allow: 'POST', 'Content-Length': 0 }); res.end(); };
    routes.set('GET /mcp', only);
    routes.set('DELETE /mcp', only);
  }
  return handle;
}

/** An http server, or https when `tls: { key, cert }` is given, running the handler above. */
export function createServer(options = {}) {
  const handler = createHandler(options);
  const server = options.tls ? https.createServer(options.tls, handler) : http.createServer(handler);
  server.keepAliveTimeout = 65_000;   // longer than nginx's default upstream keepalive (60 s) so it never races the proxy
  server.headersTimeout = 66_000;
  return server;
}
