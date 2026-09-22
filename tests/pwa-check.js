// Checks the PWA shell: manifest, service worker, deploy config and the head
// wiring in index.html. These are the files where a mistake is invisible until
// it is on a phone — a typo'd icon path or a stale-cache header does not fail
// loudly, it just means the installed app is broken or never updates.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}

const html = read('index.html');
const sw = read('sw.js');
const manifestRaw = read('manifest.json');

// A JSON parse failure here is silent in the browser — the manifest is just
// ignored, and the app quietly stops being installable.
let manifest = null;
try { manifest = JSON.parse(manifestRaw); } catch (e) { /* reported below */ }

console.log('\n[pwa-1] manifest.json');
check('parses as JSON', manifest !== null, 'invalid JSON — the browser would ignore it entirely');
if (manifest) {
  check('declares an id and a scope', manifest.id === '/' && manifest.scope === '/');
  check('start_url is the scope root', manifest.start_url === '/');
  check('display is standalone', manifest.display === 'standalone');
  check('has both theme and background colour',
    /^#[0-9a-f]{6}$/i.test(manifest.theme_color) && /^#[0-9a-f]{6}$/i.test(manifest.background_color));
  check('lists 192 and 512 any-purpose icons',
    manifest.icons.some(i => i.sizes === '192x192' && i.purpose === 'any') &&
    manifest.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'));
  // Android crops a non-maskable icon to the launcher's shape, which clips the
  // mark. Chrome also refuses to treat an install as "maskable-quality" without one.
  check('lists a maskable icon', manifest.icons.some(i => i.purpose === 'maskable'),
    'Android would crop the icon to a circle with no safe padding');
  check('every icon it names exists on disk',
    manifest.icons.every(i => fs.existsSync(path.join(ROOT, i.src.replace(/^\//, '')))),
    manifest.icons.filter(i => !fs.existsSync(path.join(ROOT, i.src.replace(/^\//, '')))).map(i => i.src).join(', '));
  check('every icon path is root-relative',
    manifest.icons.every(i => i.src.startsWith('/')),
    'a relative path resolves against the manifest URL, which breaks under a subpath deploy');
}

console.log('\n[pwa-2] iOS specifics');
// iOS ignores manifest icons entirely and looks for this exact path.
check('apple-touch-icon is linked at the root', /rel="apple-touch-icon"[^>]*icons\/apple-touch-icon\.png/.test(html));
check('apple-touch-icon.png exists at 180x180',
  fs.existsSync(path.join(ROOT, 'icons', 'apple-touch-icon.png')),
  'an installed iOS PWA would show a blank tile');
check('apple-mobile-web-app-capable is set', /name="apple-mobile-web-app-capable"\s+content="yes"/.test(html));
check('status bar style is declared', /apple-mobile-web-app-status-bar-style/.test(html));
check('theme-color is declared for both schemes',
  (html.match(/name="theme-color"/g) || []).length === 2,
  'one theme-color means the status bar cannot follow the in-app theme');
check('viewport uses viewport-fit=cover',
  /viewport-fit=cover/.test(html),
  'without it the env(safe-area-inset-*) rules in style.css all resolve to 0');
check('manifest is linked', /rel="manifest"\s+href="manifest\.json"/.test(html));

console.log('\n[pwa-3] sw.js lifecycle');
check('has an activate handler', /addEventListener\(\s*'activate'/.test(sw),
  'without one, old caches are never deleted and a deploy can serve stale app.js forever');
check('deletes caches from previous versions',
  /caches\.keys\(\)/.test(sw) && /caches\.delete\(/.test(sw));
check('claims clients on activate', /clients\.claim\(\)/.test(sw));
// skipWaiting in install would swap the app out from under a running timer.
// Slice the install handler by its neighbours rather than running a regex
// forward to the first skipWaiting in the file — the message handler below it
// has one, and a greedy scan finds that instead.
const slice = (from, to) => {
  const a = sw.indexOf(from);
  const b = sw.indexOf(to, a + from.length);
  return a > -1 && b > -1 ? sw.slice(a, b) : '';
};
check('does not call skipWaiting on install',
  !/skipWaiting/.test(slice("'install'", "'activate'")),
  'the new worker would take over mid-session instead of waiting for the prompt');
check('waits for the page to ask before activating',
  /addEventListener\(\s*'message'[\s\S]*?SKIP_WAITING[\s\S]*?skipWaiting\(\)/.test(sw),
  'skipWaiting must live in the message handler, not in install');
check('handles navigations', /request\.mode === 'navigate'/.test(sw),
  'an offline reload or deep link would 404');
check('never calls respondWith for cross-origin requests',
  /url\.origin !== self\.location\.origin/.test(sw) && /return;/.test(sw),
  'a blocked Google Fonts request would throw instead of degrading to the fallback stack');
check('only handles GET', /request\.method !== 'GET'/.test(sw));
check('does not cache the scope root and index.html as two resources',
  !/addAll\([^)]*'\.\/'/.test(sw),
  'the same document stored twice on every deploy');
check('precaches the app shell', /'\.\/index\.html'/.test(sw) && /'\.\/app\.js'/.test(sw) && /'\.\/style\.css'/.test(sw));
check('a missing optional asset cannot fail the install',
  /\.catch\(\(\) => \{\}\)/.test(sw),
  'one 404 in addAll aborts the whole install and leaves the app with no worker');
check('a failed revalidation never overwrites a good cached copy',
  /response\.ok\)\s*cache\.put/.test(sw));

console.log('\n[pwa-4] vercel.json');
let vercel = null;
try { vercel = JSON.parse(read('vercel.json')); } catch (e) { /* reported below */ }
check('parses as JSON', vercel !== null);
if (vercel) {
  const rule = (src) => (vercel.headers || []).find(h => h.source === src);
  const noCache = (src) => {
    const r = rule(src);
    return r && r.headers.some(h => /must-revalidate/.test(h.value) && /max-age=0/.test(h.value));
  };
  // The one that matters: a CDN-cached worker means updates never reach the phone.
  check('sw.js is never cached', noCache('/sw.js'),
    'a cached worker can pin the phone to an old build indefinitely');
  check('index.html is revalidated too', noCache('/index.html'),
    'a cached shell is how the app gets permanently stale');
  check('no legacy routes/rewrites block', !vercel.routes && !vercel.rewrites,
    'a static site needs none, and `version: 2` is from the retired builds pipeline');
}

console.log('\n[pwa-5] registration and the update prompt');
const app = read('app.js');
check('skips file:// and other insecure origins',
  /location\.protocol === 'https:'/.test(app) && /'serviceWorker' in navigator/.test(app),
  'opening index.html directly must keep working');
check('registration failure is caught', /register\('sw\.js'\)[\s\S]{0,900}?\.catch\(/.test(app));
check('an update is offered, not forced', /update-bar/.test(app) && /controllerchange/.test(app));
check('the update prompt is in the markup', /id="update-bar"/.test(html) && /id="update-bar-btn"/.test(html));
check('the prompt announces itself to screen readers',
  /id="update-bar"[^>]*role="status"/.test(html) && /aria-live="polite"/.test(html));
check('a first install does not bounce the page',
  /navigator\.serviceWorker\.controller/.test(app),
  'controllerchange fires on first install too; reloading there is a visible flash');
check('registration waits for load', /addEventListener\('load', wireServiceWorker\)/.test(app),
  'registering during parse competes with the first paint for bandwidth');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
