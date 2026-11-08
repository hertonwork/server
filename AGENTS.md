# Working in this repository (for agents and people)

simple-server is a static web server for a single-page app in one Node file, plus the page it serves. No npm
dependencies anywhere — not for running, not for building, not for testing. `npm start` serves, `npm run check`
verifies everything.

## Layout

| Path | What | Edit? |
|---|---|---|
| `lib/simple-server.js` | the server: `createHandler(options)` and `createServer(options)`. Path safety, MIME, caching, ETags, compression, ranges, SPA fallback, routes, errors. Options and defaults at the top | yes — add a test in the same change |
| `server.js` | the command (`npm start`, `npx @labs_kai/server [folder]`): flags (`--port --host --mcp --verbose --help --version`) over env vars (`PORT HOST PUBLIC_DIR MCP VERBOSE TLS_KEY TLS_CERT`) over defaults; prints the actual address; shuts down cleanly | yes — `test/cli.test.mjs` runs it as a child process |
| `lib/mcp.js` | the MCP endpoint (`mcp: true` / `MCP=1`): POST /mcp, Streamable HTTP, stateless, both protocol eras (2026-07-28 `server/discover`; 2025-11-25…03-26 `initialize`), four read-only tools that go through the server's own `resolve()` and handler | yes — add a test in the same change |
| `test/server.test.mjs`, `test/mcp.test.mjs` | `node:test` over a real socket against a temporary `public/`; raw `http` where `fetch()` would hide something (compression, odd URLs); the MCP suite speaks both eras | yes |
| `public/` | what is served. `index.html`, `404.html` and `sw.js` are **built** from `site/`; everything else (manifest, icons, screenshots, robots) is a plain asset | built files: no — `npm run build`. Assets: yes |
| `site/index.html`, `site/404.html` | the page templates: sscss classes, Minim bindings, the state JSON, two slots at the end of the body (`<!--minim-->`, `<!--app-->`) | yes |
| `site/app.js` | the page's own script: the request inspector, the `/api/health` poll, the PWA plumbing (install, update prompt, offline) | yes |
| `site/sw.js` | the service worker template; the build fills `__VERSION__` (a hash of every precached file) and `__PRECACHE__` | yes |
| `scripts/build.mjs` | `site/` → `public/`: inlines Minim and `app.js`, generates the sscss block for each page, versions the service worker | yes |
| `scripts/check.mjs` | the whole verification: tests, build (fails in CI when `public/` is stale), preflight, Lighthouse against this server | yes |
| `scripts/vendor.mjs`, `vendor/` | the three vendored tools: `minim.min.js` (Minim), `sscss.mjs` (the CSS generator), `preflight.mjs` (the Minim page checker). Refresh with `npm run vendor` | vendored files: no, refresh them |
| `scripts/shots.mjs`, `scripts/fireworks.mjs` | manifest screenshots + `preview.jpg`, and the Lighthouse fireworks GIF, both from this server (need Playwright, the GIF also `lighthouse` and ImageMagick; dev-only) | yes |
| `package.json` | published as `@labs_kai/server`: only `lib/`, `server.js`, README and LICENSE ship (16 KB); the `server` bin is what `npx @labs_kai/server` runs | yes |
| `.github/workflows/publish.yml` | a published GitHub release `vX.Y.Z` → tests, tag = package.json version, `npm publish --provenance` (secret `NPM_TOKEN`) | yes |
| `.github/workflows/ci.yml`, `pages.yml` | CI runs `npm run check` on every PR; Pages publishes `public/` to server.herton.work on every push to `main` | yes |
| `skills/simple-server/` | the agent skill: how to use this server for a project and how to build and verify a page the way this one was | yes |

## Commands

```sh
npm start               # serve public/ at http://127.0.0.1:2211
npm run dev             # same, verbose, restarts when a file changes
npm test                # the server's tests (node:test)
npm run build           # site/ → public/ (index.html, 404.html, sw.js)
npm run check           # tests + build + preflight + Lighthouse (if `lighthouse` is on PATH; CHROME_PATH if Chrome isn't found)
npm run check -- --no-lighthouse
npm run cert            # self-signed localhost pair → the next `npm start` is https
npm run mcp             # serve with the MCP endpoint on; then: claude mcp add --transport http server http://127.0.0.1:2211/mcp
npm run vendor          # refresh vendor/ from the Minim and sscss repositories
npm run shots           # manifest screenshots + preview.jpg (Playwright)
npm run fireworks       # public/lighthouse.gif (Playwright + lighthouse + ImageMagick)
```

## Rules that keep this project what it is

- **Zero dependencies, everywhere.** `package.json` has no `dependencies` and no `devDependencies`. The build is
  three vendored files; the tests are `node:test`; Lighthouse and Playwright are optional tools found on the machine,
  never installed by this repository. A change that needs a package needs a different approach.
- **Nothing outside `public/` is ever served.** Every path goes through `resolve()` in `lib/simple-server.js`, and the
  traversal test lists the ways people try. A new way of naming a file (a new decoding, a new separator) gets a case
  there before it gets a fix.
- **The MCP endpoint is opt-in and read-only.** Its tools reach files only through `resolve()` and responses only
  through the handler, so they never see more than a browser could; no tool writes or executes. Both protocol eras
  keep working (Claude Code speaks 2026-07-28, the TypeScript SDK 1.x speaks 2025-11-25); `test/mcp.test.mjs` covers
  each, and a change to the endpoint is checked with a real client before it ships.
- **The server never crashes on input.** A malformed URL is a 400, a missing file a 404, an unexpected error a 500 —
  logged when `VERBOSE`, never thrown out of the handler. The vanishing-file test exists for this.
- **The page is one file, 100/100/100/100, and the build keeps it so.** No external JS, CSS or fonts; initial state
  pre-rendered in the markup; Minim inlined at the end of the body; entrance motion is transform-only. The page's
  classes are [sscss](https://github.com/hertonwork/sscss) — `scripts/build.mjs` generates exactly the rules used and
  **fails on a class that is neither sscss nor styled in the page's own `<style>`**. Keep that `<style>` short.
- **Build before you judge, commit what you built.** Tests and Lighthouse run on `public/`; `npm run check` fails in
  CI when `public/` doesn't match `site/`. Edit `site/`, run `npm run build`, commit both.
- **Caching is by type, not by file.** HTML, `sw.js` and the manifest are `no-cache` so deploys show up at once;
  fingerprinted assets (`name.3f9c2a1b.ext`) are immutable for a year; everything else a day. Don't add per-file rules.
- **Lighthouse measures the real server**, not a file: compression, caching headers and the service worker all count.
  Run it with `npm run check`; the mobile and desktop presets must both be 100 in every category.
- **Design as a decision.** Large type in the system font, sections that each have their own composition, surfaces
  separated by a tone step, no gradients, hairlines or emoji in content, one accent action per screen. The rules are
  `references/design.md` in the Minim page skill; the page follows them.
- **server.herton.work is GitHub Pages, not this server.** It serves `public/` statically, so there `/api/health` is a
  404 and the page shows its static-host notes (that is by design — don't "fix" them away). Headers, compression, the
  SPA fallback and the routes are only seen where `npm start` runs; measure those locally with `npm run check`.
- **Releasing.** Bump `version` in `package.json` in a PR; after it merges, publish a GitHub release tagged `v<version>`.
  The publish workflow refuses a tag that doesn't match. `npm pack --dry-run` shows what ships.
- Commits are plain; PRs explain what changed and why in the body.

## Using this server for your own app

Replace `public/` with your build (keep `404.html` if you want a styled not-found page) and `npm start`. For a page in
the same style as the bundled one — sscss classes, Minim bindings, a generated stylesheet, Lighthouse 100 — use the
skill in `skills/simple-server/` (`npx skills add hertonwork/server`), which hands off to the
[minim-page](https://github.com/hertonwork/minim/tree/main/skills/minim-page) and
[sscss](https://github.com/hertonwork/sscss/tree/main/skills/sscss) skills for the page itself.
