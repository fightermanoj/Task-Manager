// Contrast audit for style.css
// Resolves the four effective palettes (root + theme + mode overlay) and checks
// every ink-on-surface pair that the current rules actually produce.
const fs = require('fs');
const path = require('path');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}');
  const m = css.match(re);
  if (!m) throw new Error('no block for ' + selector);
  const out = {};
  for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

const PALETTES = {
  'gui-light ': { ...block(':root'), ...block('body.theme-light') },
  'gui-dark  ': { ...block(':root'), ...block('body.theme-dark') },
  'tui-dark  ': { ...block(':root'), ...block('body.theme-dark'), ...block('body.mode-terminal.theme-dark') },
  'tui-light ': { ...block(':root'), ...block('body.theme-light'), ...block('body.mode-terminal.theme-light') },
};

// --- colour maths -----------------------------------------------------------
function srgb(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(r, g, b) { return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
function parse(c) {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{6})$/i);
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error('cannot parse colour: ' + c);
}
function over(fg, bg) { // composite a translucent fg onto an opaque bg
  return [0, 1, 2].map(i => fg[i] * fg[3] + bg[i] * (1 - fg[3]));
}
function ratio(a, b) {
  const la = lum(...a), lb = lum(...b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// token -> resolved opaque rgb, compositing any alpha onto `base`
function tok(pal, name, base) {
  const v = pal[name];
  if (v === undefined) throw new Error('undefined token ' + name);
  const c = parse(v);
  return c[3] < 1 ? over(c, base) : c;
}

// --- the pairs the stylesheet actually renders ------------------------------
// [label, ink token, surface token (opaque), the surface the ink sits on]
const SURFACES = {
  window: '--bg-window',
  section: '--bg-section',
  sidebar: '--bg-sidebar',
  card: '--bg-card',
  focusbar: '--focus-bar-bg',
};

const PAIRS = [
  // focus queue band
  ['focus bar / heading (green ink)', '--accent-green', '--focus-bar-bg', 'focusbar'],
  ['focus bar / count (dim)', '--text-dim', '--focus-bar-bg', 'focusbar'],
  ['focus bar / item title', '--text-main', '--bg-card', 'card'],
  ['focus bar / live timer (green ink)', '--accent-green', '--bg-card', 'card'],
  // task workspace
  ['workspace / section title', '--text-main', '--bg-window', 'window'],
  ['workspace / task count (dim)', '--text-dim', '--bg-window', 'window'],
  ['workspace / card title', '--text-main', '--bg-card', 'card'],
  ['workspace / repeat tag', '--accent-blue', '--blue-tint', 'card'],
  ['workspace / tracked time', '--accent-green', '--green-tint', 'card'],
  // sidebar
  ['sidebar / nav label', '--text-main', '--bg-sidebar', 'sidebar'],
  ['sidebar / section heading (dim)', '--text-dim', '--bg-sidebar', 'sidebar'],
  ['sidebar / analytics label', '--accent-blue', '--bg-sidebar', 'sidebar'],
  ['sidebar / analytics count', '--accent-blue', '--bg-sidebar', 'sidebar'],
  ['sidebar / analytics label (hover)', '--on-fill', '--fill-blue', 'sidebar'],
  ['sidebar / completed count', '--on-fill', '--fill-green', 'sidebar'],
  // day schedule — the surfaces this change introduced
  ['schedule / section title', '--text-main', '--bg-section', 'section'],
  ['schedule / empty state (dim)', '--text-dim', '--bg-section', 'section'],
  ['schedule / date label', '--accent-blue', '--bg-section', 'section'],
  ['schedule / group header', '--text-main', '--bg-sidebar', 'sidebar'],
  ['schedule / card title', '--text-main', '--bg-card', 'card'],
];

let worst = { r: 99 }, fails = 0, n = 0;

// --- surface separation -----------------------------------------------------
// Every top-level band is an island floating on the window's ground with a gap
// between, so no two islands are ever adjacent: what decides whether an island
// reads as an island is its own surface against --bg-page. A ratio of 1.000
// means the island is the same colour as the ground and only its border shows.
// (This is the sibling of the old defect, where the day schedule's background
// equalled --bg-window in three of the four palettes and did not read as a
// section at all.)
const ISLANDS = {
  'header': '--bg-header',
  'focus queue': '--focus-bar-bg',
  'workspace': '--bg-window',
  'schedule': '--bg-section',
};

let worstSep = { r: 99 }, collides = 0;
console.log('\n=== island surfaces vs. the ground ===\n');
for (const [name, pal] of Object.entries(PALETTES)) {
  const ground = tok(pal, '--bg-page', parse('#000000'));
  let min = { r: 99 };
  for (const [label, token] of Object.entries(ISLANDS)) {
    const r = ratio(tok(pal, token, parse('#000000')), ground);
    if (r < min.r) min = { r, label, token };
    const ok = r >= 1.05;
    if (!ok) collides++;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(3)}  ${name} — ${label.padEnd(12)} (${token} on --bg-page)`);
  }
  if (min.r < worstSep.r) worstSep = { ...min, name };
}
console.log(`\nweakest island overall: ${worstSep.r.toFixed(3)} — ${worstSep.label} [${worstSep.name}]`);
console.log(collides === 0 ? 'PASS (every island has a surface of its own)' : `${collides} island(s) share the page colour`);

console.log('\n=== ink on surface (WCAG AA, 4.5:1) ===\n');
for (const [name, pal] of Object.entries(PALETTES)) {
  console.log(name);
  for (const [label, ink, surface, surfaceName] of PAIRS) {
    const bg = tok(pal, surface, parse('#000000'));
    // translucent surfaces composite onto the surface they sit on
    const host = tok(pal, SURFACES[surfaceName], parse('#000000'));
    const bgResolved = parse(pal[surface])[3] < 1 ? over(parse(pal[surface]), host) : bg;
    const fg = tok(pal, ink, bgResolved);
    const r = ratio(fg, bgResolved);
    n++;
    const ok = r >= 4.5;
    if (!ok) fails++;
    if (r < worst.r) worst = { r, label, name, ink, surface };
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${r.toFixed(2).padStart(5)}:1  ${label}`);
  }
  console.log('');
}
console.log(`${n} combinations across ${Object.keys(PALETTES).length} palettes`);
console.log(`worst: ${worst.r.toFixed(2)}:1 — ${worst.label} [${worst.name}] (${worst.ink} on ${worst.surface})`);
console.log(fails === 0 ? 'PASS (all >= 4.5:1)' : `${fails} FAILURES`);
process.exit(fails === 0 && collides === 0 ? 0 : 1);
