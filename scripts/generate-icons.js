// Generates the PNG icons in icons/ from icon.svg.
//
// Run with `npm run icons`. This is the only reason the project has a
// package.json at all — the app itself is still three static files with no
// build step, and the generated PNGs are committed so a deploy never depends
// on this script having been run.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'icons');
const svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');

// Android crops a `purpose: maskable` icon to whatever shape the launcher
// likes — a circle, a squircle, a teardrop. Only the middle 80% is guaranteed
// to survive, so the maskable variant shrinks the mark to sit inside that safe
// zone. Without this the prompt glyph gets its corners clipped.
const MASKABLE_SAFE_SCALE = 0.7;
const maskableSvg = svg.replace(
  '<g id="mark">',
  `<g id="mark" transform="translate(256 256) scale(${MASKABLE_SAFE_SCALE}) translate(-256 -256)">`
);

if (maskableSvg === svg) {
  throw new Error('icon.svg no longer contains <g id="mark"> — the maskable variant would be generated unscaled');
}

const TARGETS = [
  ['icon-192.png', svg, 192],
  ['icon-512.png', svg, 512],
  ['icon-maskable-512.png', maskableSvg, 512],
  // iOS ignores manifest icons entirely and looks for this exact filename at
  // the site root. Omitting it is why an installed iOS PWA often shows a blank
  // tile. 180x180 is the size iOS asks for.
  ['apple-touch-icon.png', svg, 180],
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, source, size] of TARGETS) {
    // Render at the SVG's intrinsic 512 and downscale, rather than asking
    // sharp to rasterise directly at 192 — the resample gives cleaner edges on
    // the round caps than a low-resolution rasterisation does.
    const png = await sharp(Buffer.from(source), { density: 384 })
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(path.join(OUT, name), png);
    console.log(`  ${name.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} kB`);
  }
  console.log(`\n${TARGETS.length} icons written to icons/`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
