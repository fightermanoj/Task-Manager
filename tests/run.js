// Runs every check in tests/. `npm test`.
//
// These are the project's only execution coverage: the app has no build step
// and no framework, so a handful of self-contained Node scripts that load the
// real app.js and parse the real style.css keep the claims honest without
// adding a toolchain.
const { spawnSync } = require('child_process');
const path = require('path');

const SUITES = [
  ['app-harness.js', 'app behaviour (stub DOM)'],
  ['css-check.js', 'stylesheet structure'],
  ['contrast.js', 'colour contrast, all four palettes'],
  ['pwa-check.js', 'PWA shell and deploy config'],
  ['secrets-check.js', 'no credential can reach the repo'],
];

let failed = [];

for (const [file, label] of SUITES) {
  console.log(`\n${'='.repeat(60)}\n${file} — ${label}\n${'='.repeat(60)}`);
  // css-check takes the stylesheet as an argument; the rest take none.
  const args = file === 'css-check.js' ? [path.join(__dirname, file), path.join(__dirname, '..', 'style.css')] : [path.join(__dirname, file)];
  const res = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (res.status !== 0) failed.push(file);
}

console.log(`\n${'='.repeat(60)}`);
if (failed.length === 0) {
  console.log('ALL SUITES PASSED');
} else {
  console.log(`FAILED: ${failed.join(', ')}`);
}
process.exit(failed.length === 0 ? 0 : 1);
