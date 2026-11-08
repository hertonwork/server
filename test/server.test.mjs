// Real HTTP against a temporary public folder. Run with `npm test` (node --test).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import http from 'node:http';
import { createServer } from '../lib/simple-server.js';

let dir, server, base;
const big = 'x'.repeat(5000);

const get = (p, headers = {}, method = 'GET') => fetch(base + p, { method, headers, redirect: 'manual' });

// fetch() transparently decompresses and normalises URLs; this sends the request as written and keeps the raw bytes
const raw = (p, headers = {}) => new Promise((resolve, reject) => {
  http.request(new URL(base), { path: p, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject).end();
});

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-server-'));
  const pub = path.join(dir, 'public');
  await fs.mkdir(path.join(pub, 'docs'), { recursive: true });
  await fs.mkdir(path.join(pub, '.well-known'), { recursive: true });
  await fs.mkdir(path.join(pub, 'api'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(pub, 'index.html'), '<!doctype html><title>shell</title>'),
    fs.writeFile(path.join(pub, '404.html'), '<!doctype html><title>lost</title>'),
    fs.writeFile(path.join(pub, 'app.js'), `console.log("${big}")`),
    fs.writeFile(path.join(pub, 'app.3f9c2a1b.js'), 'fingerprinted'),
    fs.writeFile(path.join(pub, 'small.css'), 'b{}'),
    fs.writeFile(path.join(pub, 'Upper.TXT'), 'case matters'),
    fs.writeFile(path.join(pub, 'sw.js'), 'self.x=1'),
    fs.writeFile(path.join(pub, 'manifest.webmanifest'), '{}'),
    fs.writeFile(path.join(pub, 'favicon.ico'), Buffer.alloc(16)),
    fs.writeFile(path.join(pub, 'video.bin'), Buffer.from('0123456789')),
    fs.writeFile(path.join(pub, 'docs', 'index.html'), 'docs index'),
    fs.writeFile(path.join(pub, '.env'), 'SECRET=1'),
    fs.writeFile(path.join(pub, '.well-known', 'thing'), 'ok'),
    fs.writeFile(path.join(dir, 'secret.pem'), 'PRIVATE KEY'),   // one level above public, like v1's key.pem
  ]);
  server = createServer({
    publicDir: pub,
    routes: {
      'GET /api/echo': (req, res, url) => ({ q: url.searchParams.get('q') }),
      'POST /api/ping': () => ({ pong: true }),
      'GET /api/raw': (req, res) => { res.writeHead(418, { 'Content-Type': 'text/plain' }); res.end('teapot'); },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  await fs.rm(dir, { recursive: true, force: true });
});

test('serves index.html at / with charset and no-cache', async () => {
  const r = await get('/');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.match(await r.text(), /shell/);
});

test('security headers are present', async () => {
  const r = await get('/');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('strict-transport-security'), null, 'HSTS only over TLS');
});

test('path traversal never escapes publicDir', async () => {
  for (const p of ['/../secret.pem', '/%2e%2e/secret.pem', '/..%2fsecret.pem', '/docs/../../secret.pem', '/%2e%2e%2f%2e%2e%2fsecret.pem', '//..//secret.pem', '/..\\secret.pem', '/%c0%ae%c0%ae/secret.pem']) {
    const r = await raw(p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.body.toString(), /PRIVATE KEY/, p);
  }
  assert.equal((await raw('//index.html')).status, 200, 'a doubled slash is still a path, not a host');
});

test('dotfiles are hidden, /.well-known/ is not', async () => {
  assert.equal((await get('/.env')).status, 404);
  const r = await get('/.well-known/thing');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'ok');
});

test('MIME types carry a charset for text, not for binaries', async () => {
  assert.equal((await get('/small.css')).headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal((await get('/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await get('/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert.equal((await get('/favicon.ico')).headers.get('content-type'), 'image/x-icon');
});

test('file names are case-sensitive, query strings are ignored', async () => {
  assert.equal((await get('/Upper.TXT?v=2&x=1')).status, 200);
  assert.equal((await get('/upper.txt')).status, 404);
});

test('cache policy by type', async () => {
  assert.equal((await get('/small.css')).headers.get('cache-control'), 'public, max-age=86400');
  assert.equal((await get('/app.3f9c2a1b.js')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/sw.js')).headers.get('cache-control'), 'no-cache');
  assert.equal((await get('/manifest.webmanifest')).headers.get('cache-control'), 'no-cache');
});

test('ETag and Last-Modified give 304s', async () => {
  const first = await get('/small.css');
  const etag = first.headers.get('etag');
  assert.match(etag, /^W\/"/);
  const r2 = await get('/small.css', { 'If-None-Match': etag });
  assert.equal(r2.status, 304);
  const r3 = await get('/small.css', { 'If-Modified-Since': first.headers.get('last-modified') });
  assert.equal(r3.status, 304);
  const r4 = await get('/small.css', { 'If-None-Match': 'W/"nope"' });
  assert.equal(r4.status, 200);
});

test('brotli and gzip for text over 1 KB, identity otherwise', async () => {
  const br = await raw('/app.js', { 'Accept-Encoding': 'br' });
  assert.equal(br.headers['content-encoding'], 'br');
  assert.equal(br.headers.vary, 'Accept-Encoding');
  assert.ok(br.body.length < 200, 'compressed');
  assert.equal(zlib.brotliDecompressSync(br.body).toString(), `console.log("${big}")`);

  const gz = await raw('/app.js', { 'Accept-Encoding': 'gzip, deflate' });
  assert.equal(gz.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(gz.body).toString(), `console.log("${big}")`);

  const id = await raw('/app.js', { 'Accept-Encoding': 'identity' });
  assert.equal(id.headers['content-encoding'], undefined);
  assert.equal(Number(id.headers['content-length']), big.length + 15);

  const small = await raw('/small.css', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(small.headers['content-encoding'], undefined, 'tiny files are not worth compressing');
  const bin = await raw('/favicon.ico', { 'Accept-Encoding': 'br, gzip' });
  assert.equal(bin.headers['content-encoding'], undefined, 'binaries are not compressed');
});

test('Range requests for media', async () => {
  const r = await get('/video.bin', { Range: 'bytes=2-5' });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await r.text(), '2345');
  const tail = await get('/video.bin', { Range: 'bytes=-3' });
  assert.equal(await tail.text(), '789');
  assert.equal((await get('/video.bin', { Range: 'bytes=50-' })).status, 416);
  assert.equal((await get('/video.bin')).headers.get('accept-ranges'), 'bytes');
});

test('SPA fallback: extension-less paths get the shell with a 200', async () => {
  for (const p of ['/about', '/users/42', '/deep/nested/route?x=1']) {
    const r = await get(p, { Accept: 'text/html,*/*;q=0.8' });
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /shell/);
  }
  const fetchLike = await get('/about', { Accept: 'application/json' });
  assert.equal(fetchLike.status, 404, 'fetch() asking for JSON is not a page load');
  assert.equal((await get('/api/missing')).status, 404, 'unknown /api/ paths never get the shell');
});

test('missing files get the 404 page with a 404 status', async () => {
  const r = await get('/missing.png');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.match(await r.text(), /lost/);
});

test('directories: index with a slash, redirect without', async () => {
  const r = await get('/docs/');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), 'docs index');
  const redirect = await get('/docs?a=1');
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('location'), '/docs/?a=1');
});

test('HEAD sends headers and no body; other methods get 405', async () => {
  const head = await get('/small.css', {}, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '3');
  assert.equal(await head.text(), '');
  const post = await get('/', {}, 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('malformed URLs are 400, not crashes', async () => {
  assert.equal((await get('/%zz')).status, 400);
  assert.equal((await get('/a%00b')).status, 400);
  assert.equal((await get('/')).status, 200, 'still alive');
});

test('/api/health and custom routes', async () => {
  const h = await (await get('/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(typeof h.uptime, 'number');
  assert.ok(h.requests > 0);
  assert.equal(h.node, process.version);

  const echo = await get('/api/echo?q=hi');
  assert.equal(echo.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await echo.json(), { q: 'hi' });

  const ping = await get('/api/ping', {}, 'POST');
  assert.deepEqual(await ping.json(), { pong: true });

  const raw = await get('/api/raw');
  assert.equal(raw.status, 418);
  assert.equal(await raw.text(), 'teapot');
});

test('a file that vanishes between requests does not take the server down', async () => {
  const p = path.join(dir, 'public', 'gone.txt');
  await fs.writeFile(p, 'here');
  assert.equal((await get('/gone.txt')).status, 200);
  await fs.rm(p);
  assert.equal((await get('/gone.txt')).status, 404);
  assert.equal((await get('/')).status, 200);
});
