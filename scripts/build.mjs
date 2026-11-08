#!/usr/bin/env node
// Build the page: site/ → public/.   node scripts/build.mjs
//
//   site/index.html, site/404.html   page templates: sscss classes, Minim bindings, two slots at the end of the body
//   site/app.js                      the page's own script → inlined at <script><!--app--></script>
//   vendor/minim.min.js              Minim (inlined at <script><!--minim--></script>)
//   vendor/sscss.mjs                 generates exactly the CSS each page uses → <style data-sscss> before </head>
//   site/sw.js                       service worker template → public/sw.js with VERSION and PRECACHE filled in
//   vendor/shader-hero/              the hero's animation: the shader-hero harness + the traffic scene, assembled the way
//                                    the skill's inline.mjs does it → <script><!--shader--></script>
//
// No dependencies: the two vendored files are the whole toolchain (`npm run vendor` refreshes them from GitHub).
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cssFor, classesIn } from '../vendor/sscss.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...p) => path.join(root, ...p);
const read = (...p) => readFile(at(...p), 'utf8');
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;

const minim = (await read('vendor', 'minim.min.js')).trim();
const app = (await read('site', 'app.js'))
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/^\s+/, '')).join('\n').trim();   // comments and indent off
const scene = await read('vendor', 'shader-hero', 'traffic.js');
// the hero's animation: the scene goes into the harness at /*SCENE*/null; full-line comments go, newlines stay (the
// shader source keeps its own trailing // comments, which need their line ends)
const bare = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/^\s+/, '')).join('\n').trim();
const shader = bare(await read('vendor', 'shader-hero', 'hero.js'))
  .replace('/*SCENE*/null', () => bare(scene).replace(/;?\s*$/, ''));
for (const [name, js] of [['minim', minim], ['app', app], ['shader', shader]]) if (js.includes('</script')) throw new Error(`${name} contains "</script" and cannot be inlined`);

let failed = false;

async function page(name) {
  let html = await read('site', name);
  html = html.replace('<script><!--minim--></script>', () => `<script>${minim}</script>`);
  html = html.replace('<script><!--app--></script>', () => `<script>${app}</script>`);
  html = html.replace('<script><!--shader--></script>', () => `<script>${shader}</script>`);

  // the page's own classes (any <style> that isn't ours) are not unknown
  const own = new Set();
  for (const s of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style(?![^>]*data-sscss)[^>]*>([\s\S]*?)<\/style>/g))
    for (const m of s[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) own.add(m[1]);
  const { css, unknown } = cssFor([...classesIn(html)]);
  const stray = unknown.filter((c) => !own.has(c));
  if (stray.length) { failed = true; console.error(`${name}: classes that are neither sscss nor styled by the page: ${stray.join(' ')}`); }

  const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
  const head = masked.search(/<\/head>/i);
  if (head === -1) throw new Error(`${name}: no </head>`);
  html = html.slice(0, head) + `  <style data-sscss>${css}</style>\n` + html.slice(head);

  await writeFile(at('public', name), html);
  console.log(`public/${name}  ${kb(html)}  (sscss ${css.length} B, minim ${html.includes(minim) ? kb(minim) : 'not used'}${html.includes(shader) ? `, hero ${kb(shader)}` : ''})`);
}

await page('index.html');
await page('404.html');

// --- service worker: a version from the bytes of everything it precaches -------------------------------------------
const precache = ['/index.html', '/404.html', '/manifest.webmanifest', '/favicon.ico', '/apple-touch-icon.png',
  '/android-chrome-192x192.png', '/android-chrome-512x512.png', '/icon-maskable-512.png'];
const hash = createHash('sha256');
const shipped = [];
for (const p of precache) {
  try { await stat(at('public', p)); shipped.push(p); hash.update(p).update(await readFile(at('public', p))); }
  catch { console.error(`sw: ${p} is in the precache list but not in public/ — skipped`); }
}
const sw = (await read('site', 'sw.js'))
  .replace('__VERSION__', hash.digest('hex').slice(0, 8))
  .replace('__PRECACHE__', JSON.stringify(shipped));
await writeFile(at('public', 'sw.js'), sw);
console.log(`public/sw.js  ${kb(sw)}  version ${sw.match(/VERSION = '(\w+)'/)[1]}, ${shipped.length} precached`);

if (failed) process.exit(1);
