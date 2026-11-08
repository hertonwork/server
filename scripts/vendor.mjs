#!/usr/bin/env node
// Refresh the vendored toolchain from its upstream repositories.   node scripts/vendor.mjs
// These files are the whole build: minim (the page's reactivity), the sscss generator (the page's CSS), the minim
// page preflight, and the shader-hero harness with the traffic scene (the hero's animation). They are committed so that building needs no install; run this to pick up a new release.
import { writeFile } from 'node:fs/promises';

const files = {
  'vendor/minim.min.js': 'https://raw.githubusercontent.com/hertonwork/minim/main/skills/minim-page/assets/minim.min.js',
  'vendor/sscss.mjs': 'https://raw.githubusercontent.com/hertonwork/sscss/main/skills/sscss/scripts/sscss.mjs',
  'vendor/preflight.mjs': 'https://raw.githubusercontent.com/hertonwork/minim/main/skills/minim-page/scripts/check.mjs',
  'vendor/shader-hero/hero.js': 'https://raw.githubusercontent.com/hertonwork/minim/main/skills/shader-hero/assets/hero.js',
  'vendor/shader-hero/traffic.js': 'https://raw.githubusercontent.com/hertonwork/minim/main/skills/shader-hero/assets/scenes/traffic.js',
};
for (const [file, url] of Object.entries(files)) {
  const res = await fetch(url);
  if (!res.ok) { console.error(`${url}: ${res.status}`); process.exitCode = 1; continue; }
  const body = await res.text();
  await writeFile(new URL(`../${file}`, import.meta.url), body);
  console.log(`${file}  ${(body.length / 1024).toFixed(1)} KB`);
}
console.log('now: npm run build && npm run check');
