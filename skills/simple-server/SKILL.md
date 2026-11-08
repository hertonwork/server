---
name: simple-server
description: >-
  Serve a single-page app or static site with simple-server, a zero-dependency Node static server (safe paths,
  brotli/gzip, ETags and typed caching, SPA fallback, Range requests, security headers, JSON routes, optional HTTPS,
  /api/health) and ship it as an installable PWA with a versioned service worker, all scoring 100/100/100/100 on
  Lighthouse. Use this whenever someone needs to serve a built SPA or static folder with Node and nothing to install,
  wants a static server "without express", needs SPA fallback / history-mode routing on a plain server, wants a service
  worker with precache, offline shell and an update prompt, wants an MCP endpoint so an agent can inspect a running site, or is working inside the hertonwork/server
  repository. Pairs with the minim-page and sscss skills for the page itself.
---

# simple-server

One file serves the app (`lib/simple-server.js`), one file starts it (`server.js`), and `public/` is the app. There is
nothing to `npm install`: the server, its tests, the page build and the checks are plain Node. The repository ships a
demo page (sscss + Minim, a request inspector, a live `/api/health` panel, a PWA that updates itself) that is also the
shell a project replaces.

## 1. Serve a project

```sh
git clone https://github.com/hertonwork/server.git my-app && cd my-app
rm -rf public/* && cp -r ../dist/* public/      # your build; keep a 404.html if you want a styled not-found page
npm start                                        # http://127.0.0.1:2211
```

Configuration is environment variables, nothing else:

| Variable | Default | |
|---|---|---|
| `PORT` | `2211` | |
| `HOST` | `127.0.0.1` | `0.0.0.0` in a container or to reach it from another machine |
| `PUBLIC_DIR` | `public` | |
| `VERBOSE` | off | `1` logs one line per request |
| `TLS_KEY`, `TLS_CERT` | `key.pem`, `cert.pem` | when both files exist the server speaks HTTPS; `npm run cert` makes a localhost pair |

Behind nginx or Caddy leave TLS off: the proxy terminates it and talks HTTP to `127.0.0.1:2211`. Pass
`X-Forwarded-Proto` through; HSTS is only set when the socket itself is TLS.

Or use it as a module, in your own process:

```js
import { createServer } from './lib/simple-server.js';
createServer({
  publicDir: 'dist',
  maxAge: 3600,                                                    // assets that are not fingerprinted
  headers: { 'Permissions-Policy': 'camera=()', 'X-Frame-Options': null },   // add one, drop one
  routes: {
    'GET /api/time': () => ({ now: Date.now() }),                  // return an object → JSON, Cache-Control: no-store
    'POST /api/echo': (req, res) => { req.pipe(res); },            // or write the response yourself
  },
}).listen(2211);
```

`createHandler(options)` gives you just the `(req, res)` function. Every option and its default is at the top of
`lib/simple-server.js`; the behaviour, with the reasons, is in the comment block above it.

### What you get without asking

- Every path is resolved inside `publicDir`; `../`, `%2e%2e`, `..%2f`, doubled slashes, backslashes and dotfiles never
  escape it (`/.well-known/` is allowed). Case-sensitive file names, query strings ignored.
- Extension-less paths (`/about`, `/users/42`) get `index.html` with a 200 when the client accepts HTML — history-mode
  routing works. Unknown `/api/*` paths, and requests asking for JSON, get a real 404. `404.html` is served with a 404.
- Content-Type with charset; `Cache-Control` by type (HTML / `sw.js` / manifest `no-cache`; `name.3f9c2a1b.ext` a year
  `immutable`; the rest `maxAge`); weak ETag + Last-Modified → 304; brotli or gzip for text > 1 KB; `206` for ranges;
  `HEAD`; `405` for other methods; `301` for a directory without a trailing slash; `400` for malformed URLs.
- `GET /api/health` → `{ ok, started, uptime, requests, node }` for a load balancer or a status panel.

### Let an agent ask the running server (MCP)

```sh
MCP=1 npm start
claude mcp add --transport http server http://127.0.0.1:2211/mcp
```

Four read-only tools: `health`, `list_files`, `read_file`, `inspect` (status, headers and the start of the body for
any path, run through the server's own handler). Use `inspect` instead of guessing how a path is answered: the SPA
fallback, cache headers, compression and 404s are all visible in one call. `lib/mcp.js` is a dependency-free example
of an MCP server over Streamable HTTP that speaks both protocol eras; copy it as a starting point for tools of your own.

## 2. Build a page for it

The bundled page is the reference. It is built from `site/` by `scripts/build.mjs` with three vendored files in
`vendor/` — Minim, the sscss generator, the Minim page preflight — so the build has no dependencies either.

Work in this order:

1. **State** in `site/index.html`: one JSON object in `<script type="application/json" data-state="app"
   data-root="root">` with every value the page shows, at its first-paint value.
2. **Markup** with sscss classes and Minim bindings (`data-watch`, `data-show` + `hidden`, `data-model`, `data-each`,
   `data-class`, `command="--inc"`). Pre-render initial values so nothing moves when Minim binds. Follow the
   [minim-page](https://github.com/hertonwork/minim/tree/main/skills/minim-page) skill for the attributes and its
   `references/design.md` for the look; the [sscss](https://github.com/hertonwork/sscss/tree/main/skills/sscss) skill
   for the classes (`node vendor/sscss.mjs --list` prints the cheat sheet).
3. **Page-own CSS** in the plain `<style>` in the head: type ramps, the `.field` section, inputs, token overrides.
   Short. Any class you invent there is "the page's own"; any other unknown class fails the build.
4. **Script** in `site/app.js`: a few dozen lines that fetch and write into `app`; Minim renders. Mark requests that
   must bypass the service worker with an `x-probe` header. Start work after `load`, in `requestIdleCallback`.
5. `npm run build` → `public/index.html`, `public/404.html`, `public/sw.js` (its `VERSION` is a hash of everything
   precached, so an unchanged deploy leaves installed workers alone).
6. `npm run check` → tests, build, preflight, Lighthouse mobile + desktop **against this server** (install
   `lighthouse` globally; set `CHROME_PATH` if Chrome isn't found). Fix every line it prints. Commit `site/` and
   `public/` together.

### The PWA

- `public/manifest.webmanifest`: `id`, `start_url`, `scope`, `display: standalone`, a 192 and a 512 icon plus a
  **maskable** 512 (solid background, artwork inside the central 80 %), `shortcuts`, `screenshots` for wide and narrow
  (`npm run shots` takes them from the running server with Playwright, if it is on the machine).
- `site/sw.js`: precache the shell, the not-found page, the manifest and the icons; navigations network-first with the
  cached shell as fallback (the app opens offline); other files stale-while-revalidate; `/api/*` and `x-probe`
  requests are never intercepted; a `'skip'` message activates a waiting version.
- `site/app.js`: register after load; an `installed` worker while the page already has a controller means a new version
  is waiting → show the prompt; the Reload button posts `'skip'` and reloads on `controllerchange` **only then** (the
  first install also changes the controller — don't reload on it). `beforeinstallprompt` → an Install button.
- The server sends `sw.js` and the manifest with `no-cache`, so a deploy is seen on the next visit, not a day later.

### Publishing the page

`.github/workflows/pages.yml` uploads `public/` to GitHub Pages on every push to `main` (Settings → Pages → Source
"GitHub Actions"; the custom domain is set there too). Pages is a static host: `/api/*` is a 404 there, the page shows
its static-host notes, and `404.html` is served for unknown paths (including client-side routes — the SPA fallback is
the server's, not Pages'). The server itself runs wherever `npm start` runs.

## 3. Checklist before a PR

- `npm run check` is green (server and MCP tests, preflight `ok`, Lighthouse 100 ×4 mobile and desktop)
- `public/` is the result of `npm run build` from the committed `site/` (CI diffs them)
- New server behaviour has a test in `test/server.test.mjs`; new ways of naming a path are in the traversal case
- No `dependencies`, no `devDependencies`, no `<script src>`, no `<link rel="stylesheet">`, no web font
- Caching, headers and compression verified against the real server (`curl -sI http://127.0.0.1:2211/`), not a file

## Pitfalls we hit

- **`fetch()` hides what you are testing.** It decompresses bodies and normalises URLs (`//x` becomes `/x`,
  `/%2e%2e/` collapses), so the compression and traversal tests use raw `http.request`.
- **`//secret` parsed as a protocol-relative URL** (`new URL('//x', base)` makes `x` the host) and served the shell.
  Leading slashes are collapsed before parsing.
- **A fresh install triggered a reload.** `clients.claim()` fires `controllerchange` on the first visit too; reload only
  after the visitor pressed Reload.
- **The cache version read `–`.** `caches.keys()` ran before the worker finished installing; read it on `activated`.
- **Lighthouse against a plain file server docks SEO** when `/robots.txt` or `/llms.txt` come back as HTML. This server
  answers them correctly (a real file, or a 404 page with a 404 status), which is one more reason to measure against it.
- **Service-worker requests during the audit** are cheap but real: precache a handful of small files, register after
  load, and keep the page's own polling at ≥ 10 s so the network goes quiet.
- **`hidden` lost to a display utility.** Minim's `data-show` toggles the `hidden` attribute, but `class="f …"` sets
  `display:flex`, which beats the browser's `[hidden]` rule, so the "new version is ready" banner showed on every visit.
  The page's own style has `[hidden] { display: none !important }`; keep it in any page that combines the two.
- **A static host answers differently.** On GitHub Pages `/about` is a 404 (no SPA fallback), `/api/health` doesn't
  exist and an encoded slash (`%2f`) is a 400. The page detects it (no `/api/health`) and shows, under each answer,
  what `npm start` answers (`data-expect` on the options); the field section measures the visitor's own page load,
  which is true on any host, and shows process stats only when there is a process.
- **Lower-casing URLs** (v1) made `Upper.TXT` unreachable on Linux; **`max-age=31536000` on HTML** (v1) hid every
  deploy from returning visitors. Type-based caching and case-sensitive paths are the fix, not per-file rules.
