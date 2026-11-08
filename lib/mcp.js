// An MCP endpoint for simple-server: POST /mcp, Streamable HTTP, one JSON answer per request, no dependencies.
//
//   MCP=1 npm start
//   claude mcp add --transport http server http://127.0.0.1:2211/mcp
//
// It speaks both eras of the protocol, statelessly (no sessions, no SSE, no GET stream):
//   modern  2026-07-28            every request carries its version in params._meta and the MCP-Protocol-Version
//                                 header; server/discover answers what the server is; no handshake
//   legacy  2025-11-25 … 03-26    initialize first, then tools/list and tools/call
//
// Four read-only tools, held to the same path rules as the server itself (nothing outside publicDir, no dotfiles):
//   health      the process: uptime, requests served, Node version
//   list_files  what is in publicDir (path, size, type)
//   read_file   a text file's contents, or a binary file's size and type
//   inspect     how the server answers a path: status, headers, size, the start of the body — the page's inspector,
//               for agents. Runs the request through the server's own handler, in-process.
//
// Only a browser sends an Origin header, and only a page on this machine may call the endpoint (DNS-rebinding
// protection). Leave it off on a public deployment: everything it shows is public anyway, but listing is not.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import zlib from 'node:zlib';

const MODERN = ['2026-07-28'];
const LEGACY = ['2025-11-25', '2025-06-18', '2025-03-26'];
const SUPPORTED = [...MODERN, ...LEGACY];
const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const TEXT = /^(text\/|application\/(json|manifest\+json|xml|javascript)|image\/svg)/;

const tools = [
  {
    name: 'health',
    title: 'Server health',
    description: 'Is the server up, since when, how many requests it has served, which Node runs it.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'list_files',
    title: 'List served files',
    description: 'Files the server serves from its public folder, as URL paths with size and Content-Type. Hidden files are not listed.',
    inputSchema: { type: 'object', properties: { dir: { type: 'string', description: 'URL path of a folder to list, e.g. "/" or "/docs/". Default "/".' } } },
  },
  {
    name: 'read_file',
    title: 'Read a served file',
    description: 'The contents of a text file the server serves (HTML, CSS, JS, JSON, SVG, …), by URL path. For other files: size and type only.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'URL path, e.g. "/index.html"' } }, required: ['path'] },
  },
  {
    name: 'inspect',
    title: 'Inspect a response',
    description: 'How the server answers a request for a path, as a browser would send it: status, headers (cache, compression, ETag, security), body size and the start of the body. Use it to check routing, the SPA fallback, caching and 404s.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Request path with optional query, e.g. "/about" or "/app.js?v=2"' },
        method: { type: 'string', enum: ['GET', 'HEAD'], description: 'Default GET' },
      },
      required: ['path'],
    },
  },
].map((t) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } }));

/** The route handler for POST /mcp. `ctx` comes from createHandler: { root, resolve, typeOf, health, handle, version }. */
export function createMcp(ctx) {
  const serverInfo = { name: 'simple-server', version: ctx.version };
  const instructions = 'This is the web server for a single-page app. Use list_files and read_file to see what it serves '
    + 'from its public folder, inspect to see exactly how it answers a path (status, caching, compression, the SPA '
    + 'fallback, 404s), and health for the process. Everything is read-only.';

  const fail = (message) => Object.assign(new Error(message), { tool: true });   // a tool error the model can correct

  const call = {
    health: () => ctx.health(),

    async list_files({ dir = '/' } = {}) {
      const start = ctx.resolve(String(dir));
      if (!start) throw fail(`"${dir}" is outside the public folder or hidden`);
      if (!(await fs.stat(start).catch(() => null))?.isDirectory()) throw fail(`"${dir}" is not a folder`);
      const files = [], limit = 500;
      const walk = async (abs, depth) => {
        for (const d of (await fs.readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
          if (files.length > limit) return;
          const full = path.join(abs, d.name);
          const url = '/' + path.relative(ctx.root, full).split(path.sep).join('/');
          if (!ctx.resolve(url)) continue;   // hidden by the same rule the server uses
          if (d.isDirectory()) { if (depth < 8) await walk(full, depth + 1); }
          else if (d.isFile()) files.push({ path: url, size: (await fs.stat(full)).size, type: ctx.typeOf(full) });
        }
      };
      await walk(start, 0);
      return { dir, files: files.slice(0, limit), truncated: files.length > limit };
    },

    async read_file({ path: p } = {}) {
      if (typeof p !== 'string' || !p) throw fail('path is required, e.g. "/index.html"');
      const file = ctx.resolve(p);
      if (!file) throw fail(`"${p}" is outside the public folder or hidden`);
      const stat = await fs.stat(file).catch(() => null);
      if (!stat) throw fail(`no file at "${p}" (list_files shows what exists)`);
      if (stat.isDirectory()) throw fail(`"${p}" is a folder; use list_files`);
      const type = ctx.typeOf(file);
      if (!TEXT.test(type)) return { path: p, size: stat.size, type, binary: true };
      const max = 200_000;
      const text = (await fs.readFile(file, 'utf8'));
      return { path: p, size: stat.size, type, content: text.slice(0, max), truncated: text.length > max };
    },

    async inspect({ path: p, method = 'GET' } = {}) {
      if (typeof p !== 'string' || !p.startsWith('/')) throw fail('path must start with "/", e.g. "/about"');
      if (method !== 'GET' && method !== 'HEAD') throw fail('method is GET or HEAD');
      const r = await inject(ctx.handle, p, method);
      let body = r.body;
      try {
        if (r.headers['content-encoding'] === 'br') body = zlib.brotliDecompressSync(body);
        else if (r.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
      } catch { /* show what arrived */ }
      const text = TEXT.test(r.headers['content-type'] || '');
      return { request: `${method} ${p}`, status: r.status, headers: r.headers, bytes: r.body.length, ...(text && body.length ? { bodyStart: body.toString('utf8', 0, 600) } : {}) };
    },
  };

  const result = (id, value, modern) => ({ jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...value } : value });
  const error = (id, code, message, data) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

  // one JSON-RPC message → [httpStatus, body | undefined (202)]
  async function answer(msg, req) {
    if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0') return [400, error(null, -32600, 'Invalid request')];
    if (typeof msg.method !== 'string') return [202];              // a response sent to us: nothing to do
    const { id, method } = msg;
    const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
    if (id === undefined) return [202];                             // notifications (notifications/initialized, …)

    // which era: a modern request names its version in _meta; initialize opens a legacy one; anything else is legacy
    const requested = params._meta?.[VERSION_KEY];
    const modern = requested !== undefined;
    if (modern) {
      if (!MODERN.includes(requested)) return [400, error(id, -32022, 'Unsupported protocol version', { supported: SUPPORTED, requested })];
      const mismatch = headerMismatch(req, msg, requested);
      if (mismatch) return [400, error(id, -32020, `Header mismatch: ${mismatch}`)];
    }

    switch (method) {
      case 'initialize': {
        const version = LEGACY.includes(params.protocolVersion) ? params.protocolVersion : LEGACY[0];
        return [200, result(id, { protocolVersion: version, capabilities: { tools: {} }, serverInfo, instructions }, false)];
      }
      case 'server/discover':
        return [200, result(id, { supportedVersions: SUPPORTED, capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo }, instructions }, true)];
      case 'ping':
        return [200, result(id, {}, modern)];
      case 'tools/list':
        return [200, result(id, { tools }, modern)];
      case 'tools/call': {
        const fn = call[params.name];
        if (!fn) return [200, error(id, -32602, `Unknown tool: ${params.name}`)];
        try {
          const out = await fn(params.arguments || {});
          return [200, result(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out }, modern)];
        } catch (err) {
          if (!err.tool) throw err;
          return [200, result(id, { content: [{ type: 'text', text: err.message }], isError: true }, modern)];
        }
      }
      default:
        return [modern ? 404 : 200, error(id, -32601, `Method not found: ${method}`)];
    }
  }

  return async function mcp(req, res) {
    const send = (status, body) => {
      if (body === undefined) { res.writeHead(status, { 'Content-Length': 0 }); return res.end(); }
      const json = JSON.stringify(body);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(json), 'Cache-Control': 'no-store' });
      res.end(json);
    };

    // DNS rebinding: a browser always sends Origin; only a page on this machine may call
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).hostname; } catch { /* invalid → rejected */ }
      if (!LOOPBACK.has(host)) return send(403, error(null, -32600, 'Origin not allowed'));
    }

    let raw = '';
    try {
      for await (const chunk of req) { raw += chunk; if (raw.length > 1_000_000) return send(413, error(null, -32600, 'Request too large')); }
    } catch { return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return send(400, error(null, -32700, 'Parse error')); }

    if (Array.isArray(msg)) {   // JSON-RPC batches: 2025-03-26 only, but cheap to keep
      if (!msg.length) return send(400, error(null, -32600, 'Invalid request'));
      const answers = (await Promise.all(msg.map((m) => answer(m, req)))).map(([, body]) => body).filter(Boolean);
      return answers.length ? send(200, answers) : send(202);
    }
    const [status, body] = await answer(msg, req);
    send(status, body);
  };
}

// Modern requests mirror the version, the method and the tool name into headers so that proxies can route on them;
// the server must refuse a request whose headers and body disagree, or that leaves a required one out.
function headerMismatch(req, msg, version) {
  const h = req.headers;
  if (h['mcp-protocol-version'] !== version) return `MCP-Protocol-Version is ${h['mcp-protocol-version'] ?? 'missing'}, the body says ${version}`;
  if (h['mcp-method'] !== msg.method) return `Mcp-Method is ${h['mcp-method'] ?? 'missing'}, the body says ${msg.method}`;
  if (msg.method === 'tools/call') {
    let name = h['mcp-name'];
    const b64 = /^=\?base64\?(.*)\?=$/.exec(name || '');
    if (b64) name = Buffer.from(b64[1], 'base64').toString('utf8');
    if (name !== msg.params?.name) return `Mcp-Name is ${name ?? 'missing'}, the body says ${msg.params?.name}`;
  }
  return null;
}

// Run a request through the server's own handler without a socket, and collect what it writes.
async function inject(handle, url, method) {
  const chunks = [];
  let status = 0, headers = {};
  const res = new Writable({ write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  res.on('error', () => {});
  res.statusCode = 200;
  res.headersSent = false;
  res.writeHead = (code, h = {}) => {
    status = res.statusCode = code;
    headers = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
    res.headersSent = true;
    return res;
  };
  const closed = new Promise((resolve) => res.on('close', resolve));
  const req = { method, url, headers: { host: 'localhost', accept: 'text/html,*/*;q=0.8', 'accept-encoding': 'br, gzip' }, socket: { encrypted: false } };
  await handle(req, res);
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 10_000).unref())]);
  return { status, headers, body: Buffer.concat(chunks) };
}
