#!/usr/bin/env node
// Screenshots for the manifest and the README, taken from this server.   node scripts/shots.mjs
// Needs Playwright with Chromium (npx playwright install chromium) — a dev-only tool, not a dependency of the server.
//   public/screenshot-wide.png    1280×800   manifest "wide" screenshot (install dialog on desktop)
//   public/screenshot-narrow.png  750×1334   manifest "narrow" screenshot (install sheet on phones)
//   public/preview.jpg            1000×625   README preview
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../lib/simple-server.js';

const { chromium } = await import('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = createServer({ publicDir: path.join(root, 'public') });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const shot = async (file, { width, height, scale = 1, mobile = false, dark = false, clip }) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);   // the first probe and health call have landed
  await page.screenshot({ path: path.join(root, 'public', file), clip, type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 82 : undefined });
  await ctx.close();
  console.log(`public/${file}`);
};
await shot('screenshot-wide.png', { width: 1280, height: 800 });
await shot('screenshot-narrow.png', { width: 375, height: 667, scale: 2, mobile: true });
await shot('preview.jpg', { width: 1000, height: 625 });
await browser.close();
server.close();
