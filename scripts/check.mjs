#!/usr/bin/env node
// The whole verification, in one command:   node scripts/check.mjs [--no-lighthouse]
//
//   1. npm test                      the server's test-suite over a real socket
//   2. npm run build                 site/ → public/, then fails if that changed anything git tracks (stale build)
//   3. preflight public/index.html   the static checks that map onto Lighthouse audits (vendor/preflight.mjs)
//   4. lighthouse                    mobile and desktop against THIS server (compression, caching, the service
//                                    worker all count) — if `lighthouse` is installed (npm i -g lighthouse) and a
//                                    Chrome is on the machine (CHROME_PATH if it is not found)
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lib/simple-server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
  child.on('error', (error) => resolve({ error }));
  child.on('close', (code) => resolve({ code }));
});
const step = (n, title) => console.log(`\n${n}. ${title}`);
let failed = false;

step(1, 'tests');
if ((await run('node', ['--test', ...execFileSync('sh', ['-c', 'ls test/*.test.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n')])).code !== 0) failed = true;

step(2, 'build');
if ((await run('node', ['scripts/build.mjs'])).code !== 0) failed = true;
try {
  execFileSync('git', ['diff', '--quiet', '--', 'public'], { cwd: root, stdio: 'ignore' });
  console.log('public/ is up to date');
} catch (e) {
  if (e.status === 1) { console.log('public/ changed when built — commit the result of `npm run build`'); if (process.env.CI) failed = true; }
}

step(3, 'preflight');
if ((await run('node', ['vendor/preflight.mjs', 'public/index.html'])).code !== 0) failed = true;

if (!process.argv.includes('--no-lighthouse')) {
  step(4, 'lighthouse');
  const server = createServer({ publicDir: path.join(root, 'public') });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const perfMin = Number(process.env.LH_PERF_MIN) || 100;   // shared CI runners are noisy by a point or two; locally it is 100
  const audit = async (preset) => {
    const out = `/tmp/simple-server-lh-${preset}.json`;
    const args = [url, '--output=json', `--output-path=${out}`, '--quiet', '--chrome-flags=--headless=new --no-sandbox --disable-gpu'];
    if (preset === 'desktop') args.push('--preset=desktop');
    const r = await run('lighthouse', args, { stdio: ['ignore', 'ignore', 'inherit'] });
    if (r.error) return { error: r.error };
    const rep = JSON.parse(await readFile(out, 'utf8')); const c = rep.categories, a = rep.audits;
    const scores = ['performance', 'accessibility', 'best-practices', 'seo'].map((k) => Math.round(c[k].score * 100));
    const line = `${preset.padEnd(8)} perf ${scores[0]}  a11y ${scores[1]}  best ${scores[2]}  seo ${scores[3]}  | LCP ${a['largest-contentful-paint'].displayValue}  CLS ${a['cumulative-layout-shift'].displayValue}  TBT ${a['total-blocking-time'].displayValue}  requests ${a['network-requests'].details.items.length}`;
    const failing = Object.entries(a).filter(([, au]) => au.score !== null && au.score < 1 && au.scoreDisplayMode === 'binary').map(([id, au]) => `   !  ${id}: ${au.title}`);
    return { scores, line, failing };
  };
  for (const preset of ['mobile', 'desktop']) {
    let r = await audit(preset);
    if (r.error) { console.log(r.error.code === 'ENOENT' ? 'lighthouse is not installed (npm i -g lighthouse) — skipped' : `lighthouse: ${r.error.message}`); break; }
    console.log(r.line); r.failing.forEach((f) => console.log(f));
    // performance is a measurement, not a lint: a busy machine produces a bad run. One more run decides; a real
    // regression fails both, a noisy neighbour doesn't (Lighthouse itself recommends several runs)
    if (r.scores[0] < perfMin && r.scores.slice(1).every((s) => s === 100)) {
      console.log(`${' '.repeat(9)}perf below ${perfMin}: running ${preset} once more`);
      const again = await audit(preset);
      if (!again.error) { console.log(again.line); again.failing.forEach((f) => console.log(f)); if (again.scores[0] > r.scores[0]) r = again; }
    }
    if (r.scores[0] < perfMin || r.scores.slice(1).some((s) => s < 100)) failed = true;
  }
  server.closeAllConnections?.();
  server.close();
}

console.log(failed ? '\ncheck: FAILED' : '\ncheck: ok');
process.exit(failed ? 1 : 0);
