#!/usr/bin/env node
// sscss 1.0.0 — built from src/motion.mjs, src/vocab.mjs and bin/sscss.mjs by scripts/build.mjs. Do not edit; edit the sources.
// Run it (node sscss.mjs page.html --write) or import it (import { cssFor, classesIn, fullCss, core, vocab } from './sscss.mjs').
import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

// sscss/motion — the animation utilities a Minim page needs, and nothing more. Transform and opacity only; every
// one of them is switched off under prefers-reduced-motion (the `reduced` rule is added once whenever any is used).
// An entry is { css(sel), global? } : css() returns the rules for one selector, global is emitted once per page.

export const reduced = `@media(prefers-reduced-motion:reduce){*,::before,::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}`;

// one wave period, 480 wide: the ends share a tangent so the tile repeats without a seam
const wave = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 480 120' preserveAspectRatio='none'%3E%3Cpath d='M0 60C120 0 120 0 240 60S360 120 480 60V120H0z'/%3E%3C/svg%3E")`;

export const motion = {
  // fade+slide in when an element is inserted (data-each items, fragments that arrive later)
  'an-in': { css: (s) => `${s}{transition:opacity .35s,translate .35s;@starting-style{opacity:0;translate:0 -8px}}`, doc: 'ease in when inserted' },
  // scroll-driven entrance for the parts of a section: translate only (opacity fades fail contrast audits off-screen)
  'an-rise': { css: (s) => `@supports(animation-timeline:view()){${s}{animation:ss-rise linear both;animation-timeline:view();animation-range:entry 0% entry 22%}}`, global: `@keyframes ss-rise{from{transform:translateY(24px)}}`, doc: 'rise as it scrolls into view' },
  // a spinning mark, toggled by state (data-class="an-spin:spin")
  'an-spin': { css: (s) => `${s}{animation:ss-spin 1.4s cubic-bezier(.65,0,.35,1) infinite}`, global: `@keyframes ss-spin{to{transform:rotateY(1turn)}}`, doc: 'spin (toggle with data-class)' },
  // a width that follows a CSS variable with easing: meters, gauges (pair with data-bind="--pct:level")
  'an-grow': { css: (s) => `${s}{width:calc(var(--pct,0)*1%);transition:width .45s cubic-bezier(.2,.8,.2,1)}`, doc: 'width = --pct %, eased' },
  // control feedback: hover shade, press scale
  'an-fx': { css: (s) => `${s}{transition:background .15s,transform .12s,color .15s}${s}:active{transform:scale(.97)}`, doc: 'press/hover feedback for buttons' },
  // smooth color/background changes when tokens change (theme switches)
  'an-tone': { css: (s) => `${s}{transition:color .3s,background .3s,border-color .3s}`, doc: 'eased color changes' },
  // an ocean: two wave layers cut from one 480px SVG tile with mask-image, colored by the accent token (so dark mode
  // follows), moved by transform only, in opposite directions and at two speeds for parallax. Place it first inside a
  // `rel oh` parent; what follows it in the parent gets `rel` so it paints above the water.
  'an-sea': {
    css: (s) => `${s}{position:absolute;inset:auto 0 0 0;height:min(36%,200px);pointer-events:none;background:linear-gradient(transparent,color-mix(in srgb,var(--sea,var(--acc)) 10%,transparent))}` +
      `${s}::before,${s}::after{content:"";position:absolute;inset:0 -480px 0 0;--w:-480px;background:color-mix(in srgb,var(--sea,var(--acc)) 20%,transparent);-webkit-mask:${wave} repeat-x bottom/480px 72%;mask:${wave} repeat-x bottom/480px 72%;animation:ss-sea 24s linear infinite}` +
      `${s}::after{top:40%;--w:-320px;background:color-mix(in srgb,var(--sea,var(--acc)) 32%,transparent);-webkit-mask-size:320px 100%;mask-size:320px 100%;animation-duration:12s;animation-direction:reverse}`,
    global: `@keyframes ss-sea{to{transform:translateX(var(--w))}}`,
    doc: 'an ocean at the bottom of a rel oh parent (--sea sets its color; accent by default)',
    generateOnly: true,   // a hero decoration (~0.5 KB gz): generated for pages that use it, not in the "every utility" sheets
  },
  // tune the View Transitions API used by data-each
  'an-vt': { css: (s) => `${s}{}`, global: `::view-transition-group(*){animation-duration:.3s}`, doc: 'view transitions: .3s (data-each)' },
};

// sscss — the vocabulary. Short class names → declarations.
// Names are 1–3 letters plus an optional scale digit. Values reference the tokens in `core`, so a page sets its
// look (and dark mode) once in :root. Variants: `h-` hover, `m-` ≥ 768px, `l-` ≥ 1024px.

export const tokens = {
  ink: '#0b0f14', mut: '#4b5563', bg: '#fff', sf: '#f2f4f7', sf2: '#dfe3e9', acc: '#1a7a37', acci: '#fff', r: '8px',
};
export const darkTokens = {
  ink: '#e6edf3', mut: '#9ca3af', bg: '#0d1117', sf: '#161b22', sf2: '#2a313b', acc: '#3fb950', acci: '#0d1117',
};
const vars = (t) => Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(';');

/** Reset + tokens + automatic dark mode. The only CSS a page always carries. */
export const core =
  `*,::before,::after{box-sizing:border-box;border:0 solid}` +
  `body{margin:0;font:16px/1.5 ui-sans-serif,system-ui,sans-serif;background:var(--bg);color:var(--ink)}` +
  `img,svg{max-width:100%;height:auto}` +
  `:root{${vars(tokens)}}` +
  `@media(prefers-color-scheme:dark){:root{${vars(darkTokens)}}}`;

export const scale = [0, .25, .5, .75, 1, 1.5, 2, 3, 4, 6, 8];                // 0–10, rem
export const type = [.75, .875, 1, 1.125, 1.25, 1.5, 1.875, 2.25, 3, 3.75]; // t0–t9, rem
export const widths = ['20rem', '28rem', '36rem', '48rem', '60rem', '72rem', '65ch'];  // w0–w6 (w6 = prose measure)

const rem = (n) => (scale[n] === 0 ? '0' : scale[n] + 'rem');

/** name → declaration. A declaration starting with ">" is a child selector suffix (e.g. sy2). */
export const vocab = {};
export const groups = {};
const add = (group, name, decl, doc) => { vocab[name] = decl; (groups[group] ||= []).push([name, decl, doc]); };

// ---- layout ----
add('Layout', 'f', 'display:flex', 'flex row');
add('Layout', 'fc', 'display:flex;flex-direction:column', 'flex column');
add('Layout', 'fr', 'flex-direction:row', 'row (e.g. m-fr after fc)');
add('Layout', 'fw', 'flex-wrap:wrap', 'wrap');
add('Layout', 'gr', '{display:grid}&>*{min-width:0}', 'grid; children may shrink (code blocks don\'t overflow)');
for (let i = 1; i <= 6; i++) add('Layout', 'c' + i, `grid-template-columns:repeat(${i},minmax(0,1fr))`, i + ' equal columns');
add('Layout', 'bk', 'display:block', 'block');
add('Layout', 'ib', 'display:inline-block', 'inline-block');
add('Layout', 'hd', 'display:none', 'hidden');
add('Layout', 'ac', 'align-items:center', 'align center');
add('Layout', 'ae', 'align-items:end', 'align end');
add('Layout', 'jc', 'justify-content:center', 'justify center');
add('Layout', 'jb', 'justify-content:space-between', 'space between');
add('Layout', 'je', 'justify-content:end', 'justify end');
add('Layout', 'pc', 'place-items:center', 'center both axes (grid)');
add('Layout', 'x', 'flex:1', 'grow to fill');
add('Layout', 'fs0', 'flex-shrink:0', 'never shrink');
add('Layout', 'mx', 'margin-inline:auto', 'center horizontally');
add('Layout', 'rel', 'position:relative', 'relative');
add('Layout', 'abs', 'position:absolute', 'absolute');
add('Layout', 'stk', 'position:sticky;top:0', 'sticky to top');
add('Layout', 'ov', 'overflow:auto', 'scroll if needed');
add('Layout', 'oh', 'overflow:hidden', 'clip');
add('Layout', 'wf', 'width:100%', 'full width');
add('Layout', 'hf', 'height:100%', 'full height');
add('Layout', 'vh', 'min-height:100vh', 'at least the viewport');
for (let i = 0; i < widths.length; i++) add('Layout', 'w' + i, 'max-width:' + widths[i], 'max-width ' + widths[i]);

// ---- spacing ----
for (let i = 0; i < scale.length; i++) {
  const v = rem(i), d = (scale[i] + 'rem').replace('0rem', '0');
  add('Spacing', 'p' + i, 'padding:' + v, 'padding ' + d);
  add('Spacing', 'px' + i, 'padding-inline:' + v, 'padding left+right ' + d);
  add('Spacing', 'py' + i, 'padding-block:' + v, 'padding top+bottom ' + d);
  add('Spacing', 'pt' + i, 'padding-top:' + v, 'padding top ' + d);
  add('Spacing', 'pb' + i, 'padding-bottom:' + v, 'padding bottom ' + d);
  add('Spacing', 'm' + i, 'margin:' + v, 'margin ' + d);
  add('Spacing', 'mt' + i, 'margin-top:' + v, 'margin top ' + d);
  add('Spacing', 'mb' + i, 'margin-bottom:' + v, 'margin bottom ' + d);
  add('Spacing', 'my' + i, 'margin-block:' + v, 'margin top+bottom ' + d);
  add('Spacing', 'g' + i, 'gap:' + v, 'gap ' + d);
  add('Spacing', 'sy' + i, `>*+*{margin-top:${v}}`, 'space between children ' + d);
}

// ---- type ----
for (let i = 0; i < type.length; i++) add('Type', 't' + i, `font-size:${type[i]}rem;line-height:${type[i] >= 1.875 ? 1.1 : 1.5}`, `font-size ${type[i]}rem`);
add('Type', 'b', 'font-weight:700', 'bold');
add('Type', 'sb', 'font-weight:600', 'semibold');
add('Type', 'md', 'font-weight:500', 'medium');
add('Type', 'tt', 'letter-spacing:-.025em', 'tight tracking (headlines)');
add('Type', 'lt', 'line-height:1.2', 'tight leading');
add('Type', 'mono', 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace', 'monospace');
add('Type', 'up', 'text-transform:uppercase', 'uppercase');
add('Type', 'nu', 'text-decoration:none', 'no underline');
add('Type', 'tn', 'font-variant-numeric:tabular-nums', 'tabular numbers');
add('Type', 'ctr', 'text-align:center', 'text center');
add('Type', 'rt', 'text-align:right', 'text right');
add('Type', 'nw', 'white-space:nowrap', 'no wrap');
add('Type', 'bal', 'text-wrap:balance', 'balanced headline wrapping');

// ---- color roles (tokens) ----
add('Color', 'ci', 'color:var(--ink)', 'ink');
add('Color', 'cm', 'color:var(--mut)', 'muted');
add('Color', 'ca', 'color:var(--acc)', 'accent');
add('Color', 'cw', 'color:var(--acci)', 'text on accent');
add('Color', 'bg', 'background:var(--bg)', 'ground');
add('Color', 'bs', 'background:var(--sf)', 'surface');
add('Color', 'bs2', 'background:var(--sf2)', 'surface 2 (controls)');
add('Color', 'ba', 'background:var(--acc)', 'accent');

// ---- shape & feedback ----
add('Shape', 'r', 'border-radius:var(--r)', 'radius');
add('Shape', 'r2', 'border-radius:calc(var(--r)*2)', 'double radius');
add('Shape', 'rp', 'border-radius:999px', 'pill');
add('Shape', 'r0', 'border-radius:0', 'square');
add('Shape', 'bd', 'border:1px solid var(--sf2)', 'hairline border');
add('Shape', 'bd2', 'border:2px solid var(--acc)', 'accent border');
add('Shape', 'sh', 'box-shadow:0 24px 60px rgb(0 0 0/.3)', 'floating shadow (dialogs)');
add('Shape', 'tr', 'transition:.15s', 'transition');
add('Shape', 'op', 'opacity:.6', 'dimmed');
add('Shape', 'cp', 'cursor:pointer', 'pointer');
add('Shape', 'sr', 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)', 'screen-reader only');

// ---- motion (src/motion.mjs) ----
for (const [name, m] of Object.entries(motion)) add('Motion (sscss/motion)', name, m, m.doc);

export const variants = {
  h: { wrap: (rule) => rule, selector: (sel) => sel + ':hover', doc: 'on hover' },
  m: { wrap: (rules) => `@media(min-width:768px){${rules}}`, doc: 'at ≥ 768px' },
  l: { wrap: (rules) => `@media(min-width:1024px){${rules}}`, doc: 'at ≥ 1024px' },
};

/** A utility that sets a visible display (f, fc, gr, bk, ib) outranks the browser's own [hidden]{display:none}, so an
 *  element with both stays visible — Minim's data-show toggles `hidden`, and a hidden flex row would show anyway. Every
 *  page that uses such a utility gets this once; pages that don't, and the core, pay nothing. */
export const hiddenWins = '[hidden]{display:none!important}';

const esc = (c) => c.replace(/[^a-zA-Z0-9_-]/g, (ch) => '\\' + ch);
/** The CSS rule for one class name (with or without a variant prefix), or null if not in the vocabulary. */
export function ruleFor(cls) {
  const m = cls.match(/^([hml])-(.+)$/);
  const name = m ? m[2] : cls, decl = vocab[name];
  if (!decl) return null;
  let sel = '.' + esc(cls);
  if (m && m[1] === 'h') sel += ':hover';
  const global = typeof decl === 'object' ? [reduced, decl.global].filter(Boolean) : /display:(?!none)/.test(decl) ? [hiddenWins] : [];
  // decl forms: 'a:b' → .x{a:b} · '>*{…}' → .x>*{…} · '{…}&…' → .x{…} with & standing for .x
  const rule = typeof decl === 'object' ? decl.css(sel) : decl[0] === '>' ? sel + decl : decl[0] === '{' ? sel + decl.replaceAll('&', sel) : `${sel}{${decl}}`;
  return { rule, variant: m && m[1] !== 'h' ? m[1] : null, global };
}

/** CSS for a set of class names: core + their rules, media queries grouped, globals (motion, [hidden]) once. */
export function cssFor(classes, { withCore = true } = {}) {
  const base = [], media = { m: [], l: [] }, unknown = [], globals = new Set();
  for (const c of [...new Set(classes)].sort()) {
    const r = ruleFor(c);
    if (!r) { unknown.push(c); continue; }
    if (r.rule) (r.variant ? media[r.variant] : base).push(r.rule);
    r.global.forEach((g) => globals.add(g));
  }
  let css = (withCore ? core : '') + base.join('');
  for (const v of ['m', 'l']) if (media[v].length) css += variants[v].wrap(media[v].join(''));
  return { css: css + [...globals].join(''), unknown };
}

/** The class names an HTML document uses: class="…" inside tags, plus the classes Minim toggles from state with
 *  data-class="cls:key cls2:key2" (they are not in any class attribute until the state flips, but the page needs
 *  their rules). <style> and <script> contents are skipped. */
export function classesIn(html) {
  const used = new Set();
  const markup = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const tag of markup.matchAll(/<[a-zA-Z][^>]*>/g)) {
    for (const m of tag[0].matchAll(/(?<![\w-])class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) used.add(c);
    for (const m of tag[0].matchAll(/\bdata-class="([^"]*)"/g)) for (const pair of m[1].split(/\s+/)) { const c = pair.split(':')[0]; if (c) used.add(c); }
  }
  return used;
}

/** Every utility, optionally with the responsive variants — the "just load it" stylesheet. Decorations marked
 *  generateOnly (an-sea, an-shade: a KB each) are left out; they are for pages that generate their CSS. */
export function fullCss({ responsive = true } = {}) {
  const names = Object.keys(vocab).filter((n) => !vocab[n].generateOnly), plain = names.filter((n) => !n.startsWith('an-'));   // no m-an-spin
  const all = [...names, ...(responsive ? plain.flatMap((n) => ['m-' + n, 'l-' + n]) : [])];
  return cssFor(all).css;
}

// sscss — generate only the CSS a page uses and inline it.
//
//   sscss page.html            print the CSS for the classes page.html uses
//   sscss page.html --write    inline it as <style data-sscss> in <head> (replacing an earlier one)
//   sscss page.html --check    exit 1 if the page uses classes the vocabulary doesn't have
//   sscss --full               print the whole vocabulary as one stylesheet (with m-/l- variants)
//   sscss --core               print only the reset + tokens
//   sscss --list               print the cheat sheet
//
// Classes inside <style> blocks are ignored; rules in a plain <style> are the page's own and are left alone —
// that is where you write what the vocabulary doesn't cover.
//
// Also importable: `import { main } from '@labs_kai/sscss/cli'` runs the same with an argv array.

export async function main(args) {
  const flag = (f) => args.includes(f);
  const file = args.find((a) => !a.startsWith('--'));
  const gz = (s) => gzipSync(s, { level: 9 }).length;

  if (flag('--full')) { process.stdout.write(fullCss()); process.exit(0); }
  if (flag('--core')) { process.stdout.write(core); process.exit(0); }
  if (flag('--list')) {
    for (const [group, items] of Object.entries(groups)) {
      console.log(`\n${group}`);
      for (const [name, , doc] of items) console.log(`  ${name.padEnd(7)} ${doc}`);
    }
    console.log('\nVariants'); for (const [p, v] of Object.entries(variants)) console.log(`  ${(p + '-').padEnd(5)} ${v.doc}`);
    process.exit(0);
  }
  if (!file) { console.error('usage: sscss page.html [--write] [--check] | --full | --core | --list'); process.exit(2); }

  let html = await readFile(file, 'utf8');
  const used = classesIn(html);
  // classes the page styles itself (any <style> that isn't ours) are its own, not unknown
  const own = new Set();
  for (const s of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<style(?![^>]*data-sscss)[^>]*>([\s\S]*?)<\/style>/g))
    for (const m of s[1].matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) own.add(m[1]);

  const { css, unknown: notVocab } = cssFor([...used]);
  const unknown = notVocab.filter((c) => !own.has(c)), pageOwn = notVocab.filter((c) => own.has(c));
  console.error(`${file}: ${used.size} classes, ${used.size - notVocab.length} from the vocabulary${pageOwn.length ? `, ${pageOwn.length} the page's own` : ''} → ${css.length} B, ${gz(css)} B gzipped`);
  if (unknown.length) console.error(`  not in the vocabulary and not styled by the page: ${unknown.join(' ')}`);
  if (flag('--check') && unknown.length) process.exit(1);

  if (flag('--write')) {
    const tag = `<style data-sscss>${css}</style>`;
    // find our block or </head> on a copy with comments blanked out, so a comment that mentions a tag can't mislead us
    const masked = html.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
    const old = masked.match(/<style data-sscss>[^<]*<\/style>/), head = masked.search(/<\/head>/i);
    if (old) html = html.slice(0, old.index) + tag + html.slice(old.index + old[0].length);
    else if (head !== -1) html = html.slice(0, head) + `  ${tag}\n` + html.slice(head);
    else { console.error(`  ${file} has no </head> to inline into`); process.exit(1); }
    await writeFile(file, html);
    console.error(`  inlined into ${file}`);
  } else if (!flag('--check')) {
    process.stdout.write(css);
  }
}

// run as a CLI only when this file is the entry point (so the same file can be imported)
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main(process.argv.slice(2));
