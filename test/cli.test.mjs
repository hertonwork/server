// The command line, as `npx @labs_kai/server` runs it: a child process, a real port.   npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const bin = fileURLToPath(new URL('../server.js', import.meta.url));
const run = promisify(execFile);
let dir;
const children = [];

// start the CLI, wait for its first line, return the URL it printed
const start = (args, { cwd = dir, env = {} } = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, PORT: '', HOST: '', PUBLIC_DIR: '', MCP: '', VERBOSE: '', ...env } });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => {
    out += d;
    const m = /^server\s+(\S+)\s+serving (.+)$/m.exec(out);
    if (m) resolve({ url: m[1], folder: m[2].trim(), out: () => out, child });
  });
  child.stderr.on('data', (d) => { out += d; });
  child.on('exit', (code) => reject(new Error(`exited ${code}: ${out}`)));
});

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'server-cli-'));
  await fs.mkdir(path.join(dir, 'dist'));
  await fs.writeFile(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>dist</title>');
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>root</title>');
});

after(async () => {
  for (const c of children) c.kill('SIGTERM');
  await fs.rm(dir, { recursive: true, force: true });
});

test('serves the folder it is given, on the port it is given', async () => {
  const s = await start(['dist', '--port', '0']);
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(s.folder, './dist');
  const r = await fetch(s.url + '/');
  assert.match(await r.text(), /<title>dist<\/title>/);
  assert.match(await (await fetch(s.url + '/some/route', { headers: { Accept: 'text/html' } })).text(), /dist/, 'SPA fallback');
});

test('no folder: ./public when it exists, otherwise the current folder', async () => {
  const s = await start(['-p', '0']);
  assert.equal(s.folder, './');
  assert.match(await (await fetch(s.url + '/')).text(), /<title>root<\/title>/);
});

test('flags beat environment variables', async () => {
  const s = await start(['--port=0', 'dist'], { env: { PORT: '1', PUBLIC_DIR: 'nope' } });
  assert.match(await (await fetch(s.url + '/')).text(), /dist/);
});

test('--mcp turns the endpoint on and prints how to add it', async () => {
  const s = await start(['dist', '--port', '0', '--mcp']);
  await new Promise((r) => setTimeout(r, 100));
  assert.match(s.out(), /claude mcp add --transport http server http:\/\/127\.0\.0\.1:\d+\/mcp/);
  const r = await fetch(s.url + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(r.status, 200);
});

test('--help, --version, and clear errors', async () => {
  const { stdout } = await run(process.execPath, [bin, '--help']);
  assert.match(stdout, /Usage: npx @labs_kai\/server \[folder\]/);
  const { stdout: v } = await run(process.execPath, [bin, '--version']);
  assert.match(v.trim(), /^\d+\.\d+\.\d+$/);
  for (const [args, message] of [[['missing-folder'], /"missing-folder" is not a folder/], [['--port', 'abc'], /"abc" is not a port number/], [['--nope'], /unknown option --nope/], [['a', 'b'], /one folder at a time/], [['--port'], /--port needs a value/]]) {
    await assert.rejects(run(process.execPath, [bin, ...args], { cwd: dir }), (e) => e.code === 1 && message.test(e.stderr), args.join(' '));
  }
});
