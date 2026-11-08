#!/usr/bin/env node
// Preflight for a Minim page.  node check.mjs page.html [--lighthouse]
// Static checks map onto the Lighthouse audits that cost points on a one-file page, plus whether the sscss block is
// current. --lighthouse also serves the
// file on a local port and runs `lighthouse` (mobile + desktop) if it is installed (npm i -g lighthouse) and a
// Chrome/Chromium is on the machine (set CHROME_PATH if it is not found).
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';

const [file, ...flags] = process.argv.slice(2);
if (!file) { console.error('usage: node check.mjs page.html [--lighthouse]'); process.exit(2); }
const html = await readFile(file, 'utf8');
const problems = [], notes = [];
const fail = (m) => problems.push(m);
const has = (re) => re.test(html);
const count = (re) => (html.match(re) || []).length;
const strip = (s) => s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '');
const body = strip(html);

// --- requests: the whole method is that there are none ---
for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi)) fail(`external script: ${m[1]} — inline it (scripts/inline.mjs for Minim)`);
for (const m of html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)) fail(`external stylesheet: ${m[0].slice(0, 80)} — inline the CSS`);
for (const m of html.matchAll(/<link\b[^>]*rel=["']preload["'][^>]*>/gi)) fail(`preload link: ${m[0].slice(0, 80)} — a one-file page has nothing to preload`);
if (has(/@import\s/i) || has(/fonts\.googleapis|fonts\.gstatic|typekit|use\.fontawesome/i)) fail('web font or @import — use the system font stack');
if (has(/@font-face/i)) notes.push('@font-face found: make sure it is a data: URL or a local() face, never a request');
for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
  const tag = m[0];
  if (!/\bwidth=/.test(tag) || !/\bheight=/.test(tag)) fail(`img without width+height (layout shift): ${tag.slice(0, 80)}`);
  if (!/\balt=/.test(tag)) fail(`img without alt: ${tag.slice(0, 80)}`);
  if (/\bsrc=["']https?:/.test(tag)) notes.push(`img from another origin (a request): ${tag.slice(0, 80)} — consider inline SVG`);
}
for (const m of html.matchAll(/<(iframe|video|audio)\b[^>]*>/gi)) notes.push(`<${m[1]}> found — each one is at least one request; make sure it is below the fold and lazy`);

// --- document ---
if (!/^\s*<!doctype html>/i.test(html)) fail('missing <!DOCTYPE html>');
if (!has(/<html\b[^>]*\blang=/i)) fail('<html> without lang');
if (!has(/<meta\b[^>]*charset=/i)) fail('missing <meta charset>');
if (!has(/<meta\b[^>]*name=["']viewport["']/i)) fail('missing <meta name="viewport">');
if (!has(/<title>[^<]{3,}<\/title>/i)) fail('missing or empty <title>');
if (!has(/<meta\b[^>]*name=["']description["'][^>]*content=["'][^"']{20,}/i)) fail('missing <meta name="description"> (SEO audit)');
if (!has(/<link\b[^>]*rel=["']canonical["']/i)) notes.push('no <link rel="canonical"> — add one once the URL is known');
if (!has(/<link\b[^>]*rel=["']icon["'][^>]*href=["']data:/i)) notes.push('favicon is not a data: URL — browsers will request /favicon.ico');
if (!has(/<meta\b[^>]*name=["']color-scheme["']/i)) notes.push('no <meta name="color-scheme" content="light dark">');

// --- headings ---
const h1s = count(/<h1\b/gi);
if (h1s !== 1) fail(`${h1s} <h1> elements — exactly one, on the first screen`);
const levels = [...body.matchAll(/<h([1-6])\b/gi)].map(m => +m[1]);
for (let i = 1; i < levels.length; i++) if (levels[i] > levels[i - 1] + 1) { fail(`heading order skips a level: h${levels[i - 1]} → h${levels[i]} (make panel titles <p class="title">)`); break; }
for (const m of body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) { const t = m[1].replace(/<[^>]+>/g, '').trim(); if (t.length > 40) notes.push(`h1 is ${t.length} characters — keep it to two lines (≈32 characters)`); }

// --- controls ---
for (const m of body.matchAll(/<button\b[^>]*>/gi)) {
  const tag = m[0];
  if (!/\btype=/.test(tag)) fail(`button without type="button": ${tag.slice(0, 70)}`);
  if (/\bcommand=["']--/.test(tag) && !/\bcommandfor=/.test(tag)) fail(`--command button without commandfor: ${tag.slice(0, 70)}`);
}
const rootId = (html.match(/data-root=["']([^"']+)/) || [])[1];
for (const m of body.matchAll(/<button\b[^>]*command=["']--[^"']*["'][^>]*commandfor=["']([^"']+)/gi)) {
  if (rootId && m[1] !== rootId) fail(`commandfor="${m[1]}" but the bound root is "${rootId}"`);
}
for (const m of body.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
  const tag = m[0]; if (/type=["'](hidden|submit|button)/.test(tag)) continue;
  const id = (tag.match(/\bid=["']([^"']+)/) || [])[1];
  const labelled = /\baria-label(ledby)?=/.test(tag) || (id && new RegExp(`<label\\b[^>]*for=["']${id}["']`).test(body));
  if (!labelled) {
    // wrapped in a <label>? look back for an unclosed <label before this tag
    const before = body.slice(0, m.index); const open = before.lastIndexOf('<label'), close = before.lastIndexOf('</label>');
    if (open === -1 || close > open) fail(`unlabelled control: ${tag.slice(0, 70)} — wrap it in <label> or add aria-label`);
  }
}
for (const m of body.matchAll(/<a\b[^>]*>/gi)) if (!/\bhref=/.test(m[0])) fail(`<a> without href: ${m[0].slice(0, 60)}`);

// --- minim ---
if (!has(/<script\b[^>]*type=["']application\/json["'][^>]*data-state/i)) fail('no <script type="application/json" data-state> state tag');
else { try { for (const m of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*data-state[^>]*>([\s\S]*?)<\/script>/gi)) JSON.parse(m[1]); } catch (e) { fail(`state tag is not valid JSON: ${e.message}`); } }
const inlined = /<script>(?:"use strict";)?(?:var minim=|\(\(\)=>\{)/.test(html);
if (!inlined) fail('Minim is not inlined (run scripts/inline.mjs; the slot is <script><!--minim--></script>)');
else {
  const bodyEnd = html.lastIndexOf('</body>'), pos = html.search(/<script>(?:"use strict";)?(?:var minim=|\(\(\)=>\{)/);
  const inHead = pos < html.search(/<body\b/i);
  if (inHead) notes.push('Minim is inlined in <head>; at the end of <body> it binds before first paint');
  if (bodyEnd !== -1 && pos > bodyEnd) fail('Minim script is after </body>');
}
let state = {};
try { state = JSON.parse((html.match(/<script\b[^>]*data-state[^>]*>([\s\S]*?)<\/script>/i) || [])[1] || '{}'); } catch {}
const initial = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state);
const templates = [...body.matchAll(/<template[\s\S]*?<\/template>/gi)].map(m => [m.index, m.index + m[0].length]);
for (const m of body.matchAll(/<([a-z]+)\b[^>]*data-watch=["']([^"']+)["'][^>]*>\s*<\/\1>/gi)) {
  const key = m[2];
  if (key.startsWith('$') || templates.some(([a, b]) => m.index > a && m.index < b)) continue;   // list items render later anyway
  const v = initial(key);
  if (v !== undefined && v !== '' && v !== null) notes.push(`empty data-watch="${key}" but its initial value is ${JSON.stringify(v)} — pre-render it to avoid a layout shift`);
}
for (const m of body.matchAll(/<[a-z]+\b[^>]*data-show=["']([^"']+)["'][^>]*>/gi)) if (!/\bhidden\b/.test(m[0])) notes.push(`data-show="${m[1]}" without hidden — add it if the initial value is falsy`);
if (has(/@keyframes\s+\w+\s*\{[^}]*opacity/i) && has(/animation-timeline:\s*view\(\)/i)) fail('scroll-driven entrance animates opacity — off-screen text fails the contrast audit; transform only');
if (!has(/prefers-reduced-motion/i) && !has(/<style data-sscss>[^<]*prefers-reduced-motion/)) notes.push('no prefers-reduced-motion block');

// --- sscss: the generated block must match the markup (classes change → run scripts/sscss.mjs page.html --write) ---
if (has(/<style data-sscss>/)) {
  const { execFileSync } = await import('node:child_process');
  const gen = path.join(path.dirname(new URL(import.meta.url).pathname), 'sscss.mjs');
  try {
    const fresh = execFileSync('node', [gen, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const current = (html.match(/<style data-sscss>([^<]*)<\/style>/) || [])[1] || '';
    if (fresh !== current) fail(`<style data-sscss> is stale — run node scripts/sscss.mjs ${path.basename(file)} --write after editing classes`);
  } catch (e) { notes.push(`could not verify the sscss block (${e.message.split('\n')[0]})`); }
  const own = new Set([...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style(?![^>]*data-sscss)[^>]*>([\s\S]*?)<\/style>/g)].flatMap((m) => [...m[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((x) => x[1])));
  const rules = new Set([...((html.match(/<style data-sscss>([^<]*)<\/style>/) || [])[1] || '').matchAll(/\.((?:\\.|[\w-])+)[{:>]/g)].map((m) => m[1].replace(/\\(.)/g, '$1')));
  const used = new Set([...body.matchAll(/<[a-zA-Z][^>]*>/g)].flatMap((t) => [...t[0].matchAll(/(?<![\w-])class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean))));
  const stray = [...used].filter((c) => !rules.has(c) && !own.has(c));
  if (stray.length) notes.push(`classes with no rule anywhere (not sscss, not the page's own <style>): ${stray.join(' ')}`);
} else if (has(/class="[^"]*\b(?:an-fx|an-in|an-rise|m-c2|r2 bs)\b/)) {
  fail('sscss classes in the markup but no <style data-sscss> block — run node scripts/sscss.mjs page.html --write');
}
if (!has(/prefers-color-scheme/i)) notes.push('no dark mode (prefers-color-scheme)');
if (has(/<pre\b/i) && has(/grid-template-columns/i) && !has(/min-width:\s*0/i)) notes.push('grid + <pre> without min-width: 0 on grid children — may overflow on phones');
if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(body.replace(/<[^>]+>/g, ''))) notes.push('emoji in content');

// --- report ---
const kb = (html.length / 1024).toFixed(1);
console.log(`${file}: ${kb} KB, ${count(/<script\b[^>]*\bsrc=/gi) + count(/<link\b[^>]*rel=["']stylesheet/gi)} external JS/CSS requests`);
for (const p of problems) console.log(`  FAIL  ${p}`);
for (const n of notes) console.log(`  note  ${n}`);
if (!problems.length) console.log('  ok    no blocking problems');

if (flags.includes('--lighthouse')) {
  // Serve the page at / only: Lighthouse also probes /robots.txt, /llms.txt and a manifest, and if those come back as
  // HTML its SEO audits mark them invalid (SEO 92 on an otherwise perfect page). A 404 makes them "not applicable".
  const server = createServer(async (req, res) => {
    if (req.url.split('?')[0] !== '/') { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  }).listen(0);
  const url = `http://localhost:${server.address().port}/`;
  // spawn, not spawnSync: the server above lives in this process and must keep answering while Lighthouse runs
  const run = (args) => new Promise((resolve) => {
    const child = spawn('lighthouse', args, { stdio: ['ignore', 'ignore', 'inherit'], env: process.env });
    const timer = setTimeout(() => { child.kill(); resolve({ error: { code: 'ETIMEDOUT' } }); }, 180_000);
    child.on('error', (error) => { clearTimeout(timer); resolve({ error }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code }); });
  });
  for (const preset of ['mobile', 'desktop']) {
    const out = `/tmp/minim-lh-${preset}.json`;
    const args = [url, '--output=json', `--output-path=${out}`, '--quiet', '--chrome-flags=--headless=new --no-sandbox --disable-gpu'];
    if (preset === 'desktop') args.push('--preset=desktop');
    const r = await run(args);
    if (r.error) { console.log(`  lighthouse could not run (${r.error.code}): ${r.error.code === 'ENOENT' ? 'npm i -g lighthouse' : r.error.message || ''}`); break; }
    try {
      const rep = JSON.parse(await readFile(out, 'utf8')); const c = rep.categories, a = rep.audits;
      console.log(`  ${preset.padEnd(7)} perf ${Math.round(c.performance.score * 100)}  a11y ${Math.round(c.accessibility.score * 100)}  best ${Math.round(c['best-practices'].score * 100)}  seo ${Math.round(c.seo.score * 100)}  | LCP ${a['largest-contentful-paint'].displayValue}  CLS ${a['cumulative-layout-shift'].displayValue}  TBT ${a['total-blocking-time'].displayValue}  requests ${a['network-requests'].details.items.length}`);
      for (const [id, au] of Object.entries(a)) if (au.score !== null && au.score < 1 && au.scoreDisplayMode === 'binary') console.log(`     !  ${id}: ${au.title}`);
    } catch (e) { console.log(`  could not read ${out}: ${e.message}`); }
  }
  server.close();
}
process.exit(problems.length ? 1 : 0);
