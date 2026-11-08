// The MCP endpoint, both protocol eras, over a real socket.   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../lib/simple-server.js';

let dir, server, base, off, offBase;
const MODERN = '2026-07-28';

// a legacy-era message: no _meta, no metadata headers
const legacy = (body, headers = {}) => fetch(`${base}/mcp`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body),
});
// a modern-era request: version in _meta and mirrored into headers, as a 2026-07-28 client sends it
const modern = (method, params = {}, { headers = {}, version = MODERN } = {}) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': version, 'Mcp-Method': method, ...(params.name ? { 'Mcp-Name': params.name } : {}), ...headers,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
});
const callTool = async (name, args = {}) => (await (await modern('tools/call', { name, arguments: args })).json()).result;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'simple-server-mcp-'));
  const pub = path.join(dir, 'public');
  await fs.mkdir(path.join(pub, 'docs'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(pub, 'index.html'), '<!doctype html><title>shell</title>' + 'x'.repeat(2000)),
    fs.writeFile(path.join(pub, '404.html'), '<!doctype html><title>lost</title>'),
    fs.writeFile(path.join(pub, 'docs', 'guide.md'), '# Guide'),
    fs.writeFile(path.join(pub, 'logo.png'), Buffer.alloc(64)),
    fs.writeFile(path.join(pub, '.env'), 'SECRET=1'),
    fs.writeFile(path.join(dir, 'secret.pem'), 'PRIVATE KEY'),
  ]);
  server = createServer({ publicDir: pub, mcp: true });
  off = createServer({ publicDir: pub });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  await new Promise((r) => off.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  offBase = `http://127.0.0.1:${off.address().port}`;
});

after(async () => {
  for (const s of [server, off]) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)); }
  await fs.rm(dir, { recursive: true, force: true });
});

test('off unless asked for: POST /mcp is a 405 by default', async () => {
  const r = await fetch(`${offBase}/mcp`, { method: 'POST', body: '{}' });
  assert.equal(r.status, 405);
});

test('legacy era: initialize, initialized, tools/list', async () => {
  const init = await legacy({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
  assert.equal(init.status, 200);
  assert.equal(init.headers.get('content-type'), 'application/json; charset=utf-8');
  const { result } = await init.json();
  assert.equal(result.protocolVersion, '2025-06-18', 'echoes a version it supports');
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.equal(result.serverInfo.name, 'simple-server');
  assert.equal(init.headers.get('mcp-session-id'), null, 'stateless: no session');

  const newer = await (await legacy({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } })).json();
  assert.equal(newer.result.protocolVersion, '2025-11-25', 'an unknown version gets the latest legacy one');

  const note = await legacy({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), '');

  const list = await (await legacy({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'MCP-Protocol-Version': '2025-06-18' })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name), ['health', 'list_files', 'read_file', 'inspect']);
  assert.ok(list.result.tools.every((t) => t.inputSchema.type === 'object' && t.annotations.readOnlyHint));
  assert.equal(list.result.resultType, undefined, 'legacy results carry no resultType');
});

test('legacy era: tools/call and batches', async () => {
  const r = await (await legacy({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'health', arguments: {} } })).json();
  assert.equal(r.result.structuredContent.ok, true);
  assert.equal(JSON.parse(r.result.content[0].text).ok, true);

  const batch = await (await legacy([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 6, method: 'tools/list' }])).json();
  assert.deepEqual(batch.map((m) => m.id), [5, 6]);
});

test('modern era: server/discover, no handshake needed', async () => {
  const r = await modern('server/discover');
  assert.equal(r.status, 200);
  const { result } = await r.json();
  assert.equal(result.resultType, 'complete');
  assert.ok(result.supportedVersions.includes(MODERN) && result.supportedVersions.includes('2025-11-25'));
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.equal(result._meta['io.modelcontextprotocol/serverInfo'].name, 'simple-server');
  assert.match(result.instructions, /read-only/);
});

test('modern era: version and header rules', async () => {
  const unsupported = await modern('tools/list', {}, { version: '1900-01-01' });
  assert.equal(unsupported.status, 400);
  const u = await unsupported.json();
  assert.equal(u.error.code, -32022);
  assert.equal(u.error.data.requested, '1900-01-01');
  assert.ok(u.error.data.supported.includes(MODERN));

  const wrongMethod = await modern('tools/list', {}, { headers: { 'Mcp-Method': 'tools/call' } });
  assert.equal(wrongMethod.status, 400);
  assert.equal((await wrongMethod.json()).error.code, -32020);

  const wrongName = await modern('tools/call', { name: 'health', arguments: {} }, { headers: { 'Mcp-Name': 'inspect' } });
  assert.equal((await wrongName.json()).error.code, -32020);

  const b64 = await modern('tools/call', { name: 'health', arguments: {} }, { headers: { 'Mcp-Name': `=?base64?${Buffer.from('health').toString('base64')}?=` } });
  assert.equal((await b64.json()).result.structuredContent.ok, true, 'a Base64-encoded Mcp-Name is decoded before comparing');

  const unknown = await modern('resources/list');
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, -32601);
});

test('list_files: what is served, never hidden or outside files', async () => {
  const r = await callTool('list_files');
  assert.equal(r.resultType, 'complete');
  const paths = r.structuredContent.files.map((f) => f.path);
  assert.deepEqual(paths, ['/404.html', '/docs/guide.md', '/index.html', '/logo.png']);
  assert.equal(r.structuredContent.files.find((f) => f.path === '/logo.png').type, 'image/png');
  assert.deepEqual((await callTool('list_files', { dir: '/docs/' })).structuredContent.files.map((f) => f.path), ['/docs/guide.md']);
  assert.deepEqual((await callTool('list_files', { dir: '/../' })).structuredContent.files.length, 4, '/../ normalises to / — inside, like the server');
  assert.equal((await callTool('list_files', { dir: '/.git/' })).isError, true, 'hidden');
  assert.equal((await callTool('list_files', { dir: '/logo.png' })).isError, true, 'not a folder');
});

test('read_file: text, binary metadata, and the same path rules as the server', async () => {
  const md = (await callTool('read_file', { path: '/docs/guide.md' })).structuredContent;
  assert.equal(md.content, '# Guide');
  assert.equal(md.type, 'text/markdown; charset=utf-8');
  const png = (await callTool('read_file', { path: '/logo.png' })).structuredContent;
  assert.deepEqual([png.binary, png.size, png.content], [true, 64, undefined]);
  for (const p of ['/../secret.pem', '/%2e%2e/secret.pem', '/.env', '/docs/../../secret.pem']) {
    const r = await callTool('read_file', { path: p });
    assert.equal(r.isError, true, p);
    assert.doesNotMatch(r.content[0].text, /PRIVATE KEY|SECRET/, p);
  }
  const missing = await callTool('read_file', { path: '/nope.txt' });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /list_files/, 'the error tells the model what to do next');
});

test('inspect: the server\'s own answer, in-process', async () => {
  const shell = (await callTool('inspect', { path: '/about' })).structuredContent;
  assert.equal(shell.status, 200, 'SPA fallback');
  assert.equal(shell.headers['content-encoding'], 'br');
  assert.equal(shell.headers['cache-control'], 'no-cache');
  assert.match(shell.bodyStart, /<title>shell<\/title>/, 'the body is decompressed for reading');
  assert.ok(shell.bytes < 2000, 'bytes is the size on the wire');

  assert.equal((await callTool('inspect', { path: '/missing.png' })).structuredContent.status, 404);
  assert.equal((await callTool('inspect', { path: '/..%2fsecret.pem' })).structuredContent.status, 404);
  const head = (await callTool('inspect', { path: '/logo.png', method: 'HEAD' })).structuredContent;
  assert.deepEqual([head.status, head.bytes, head.headers['content-type']], [200, 0, 'image/png']);
  assert.equal((await callTool('inspect', { path: 'no-slash' })).isError, true);
  assert.equal((await callTool('inspect', { path: '/mcp' })).structuredContent.status, 405, 'GET /mcp: no stream in a stateless server');
});

test('browsers: only a page on this machine may call (DNS rebinding)', async () => {
  const evil = await legacy({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://evil.example:2211' });
  assert.equal(evil.status, 403);
  const local = await legacy({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://localhost:2211' });
  assert.equal(local.status, 200);
});

test('bad input is a JSON-RPC error, not a crash', async () => {
  const parse = await fetch(`${base}/mcp`, { method: 'POST', body: '{nope' });
  assert.equal(parse.status, 400);
  assert.equal((await parse.json()).error.code, -32700);
  assert.equal((await legacy({ id: 1, method: 'ping' })).status, 400, 'jsonrpc: "2.0" is required');
  const unknownTool = await (await legacy({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'rm_rf' } })).json();
  assert.equal(unknownTool.error.code, -32602);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE' })).status, 405);
  assert.equal((await fetch(`${base}/`)).status, 200, 'still serving');
});
