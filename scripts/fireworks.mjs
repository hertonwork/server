#!/usr/bin/env node
// The Lighthouse fireworks, as a GIF for the README.   node scripts/fireworks.mjs
// Runs Lighthouse (mobile) against this server, opens the HTML report in dark mode — all four categories at 100 turn
// on the report's own fireworks — and records 5 s of them with the animations stepped deterministically, so the GIF
// loops. Dev-only: needs `lighthouse` on PATH (CHROME_PATH if Chrome isn't found), Playwright with Chromium, and
// ImageMagick's `convert` for the GIF itself.   → public/lighthouse.gif (≈450 KB)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lib/simple-server.js';

const { chromium } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fireworks-'));

const server = createServer({ publicDir: path.join(root, 'public') });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const report = path.join(tmp, 'report');
await new Promise((resolve, reject) => {
  const lh = spawn('lighthouse', [url, '--output=html', '--output=json', `--output-path=${report}`, '--quiet', '--chrome-flags=--headless=new --no-sandbox --disable-gpu'], { stdio: ['ignore', 'ignore', 'inherit'] });
  lh.on('error', reject); lh.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`lighthouse exited ${c}`))));
});
server.close();
const scores = Object.values(JSON.parse(fs.readFileSync(`${report}.report.json`, 'utf8')).categories).map((c) => Math.round(c.score * 100));
console.log('scores', scores.join(' '));
if (scores.some((s) => s < 100)) { console.error('no fireworks under 100 — fix the page first'); process.exit(1); }

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1000, height: 560 }, colorScheme: 'dark' })).newPage();
await page.goto(`file://${report}.report.html`); await page.waitForTimeout(1500);
await page.evaluate(() => document.getAnimations().forEach((a) => a.pause()));
const fps = 10, seconds = 5;   // the particles' drift cycle is 5 s
for (let i = 0; i < fps * seconds; i++) {
  await page.evaluate((t) => document.getAnimations().forEach((a) => { a.currentTime = t; }), 1350 + i * (1000 / fps));
  await page.screenshot({ path: path.join(tmp, `f${String(i).padStart(3, '0')}.png`), clip: { x: 0, y: 0, width: 1000, height: 200 } });
}
await browser.close();

const out = path.join(root, 'public', 'lighthouse.gif');
try {
  execFileSync('convert', ['-delay', String(100 / fps), '-loop', '0', ...fs.readdirSync(tmp).filter((f) => f.startsWith('f')).sort().map((f) => path.join(tmp, f)), '-colors', '96', '-layers', 'OptimizeTransparency', out]);
  console.log(`public/lighthouse.gif  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
} catch (e) {
  console.error(`ImageMagick's convert is not available (${e.code || e.message}); the frames are in ${tmp}`);
  process.exit(1);
}
fs.rmSync(tmp, { recursive: true, force: true });
