// Guards the line between what is safe to publish and what is not.
//
// This suite exists because the two keys look almost identical on the Supabase
// settings page and sit one line apart, and the wrong one is catastrophic
// rather than merely embarrassing:
//
//   anon key    `eyJ...` with "role":"anon"      — a public name tag. Safe to
//                                                  ship; RLS is the boundary.
//   secret key  `sb_secret_...` / service_role   — ignores every RLS policy.
//                                                  Full read/write on every
//                                                  row of every account.
//
// It runs over tracked files, because those are what Vercel deploys and what a
// visitor can fetch.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}

const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').map(s => s.trim()).filter(Boolean);

console.log('\n[sec-1] Nothing secret is tracked');
check('git is listing files', tracked.length > 0);

// Read everything once; the repo is small and this keeps the checks readable.
const contents = new Map();
for (const f of tracked) {
  const abs = path.join(ROOT, f);
  try {
    const buf = fs.readFileSync(abs);
    // Skip anything that is not plausibly text rather than guessing by name.
    if (buf.length < 2_000_000 && !buf.includes(0)) contents.set(f, buf.toString('utf8'));
  } catch (err) { /* deleted but still tracked; ignore */ }
}

const findIn = (re) => [...contents.entries()]
  .filter(([, text]) => re.test(text))
  .map(([f]) => f);

// The new key format. Anything matching this is a full-access key.
check('no sb_secret_ key anywhere in the repo',
  findIn(/sb_secret_[A-Za-z0-9_-]+/).length === 0,
  findIn(/sb_secret_[A-Za-z0-9_-]+/).join(', '));

// Other Supabase credential shapes worth catching if one is ever pasted in.
//
// Matches a service_role key being *used* — as a role claim, or as the value of
// something named like a key — rather than the bare word. .gitignore and
// config.js both name it in a warning to whoever reads them next, and flagging
// that prose would train us to ignore this check.
const SERVICE_ROLE_USE = /"role"\s*:\s*"service_role"|service_role[a-z_]*["']?\s*[:=]\s*["']?eyJ|SERVICE_ROLE_KEY\s*[=:]\s*\S/i;
check('no legacy service_role key in use',
  findIn(SERVICE_ROLE_USE).length === 0,
  findIn(SERVICE_ROLE_USE).join(', '));
check('no Supabase personal access token',
  findIn(/\bsbp_[A-Za-z0-9]{20,}/).length === 0,
  findIn(/\bsbp_[A-Za-z0-9]{20,}/).join(', '));
check('no database connection string',
  findIn(/postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"]*@/).length === 0,
  findIn(/postgres(?:ql)?:\/\/[^\s'"]*:[^\s'"]*@/).join(', '));

console.log('\n[sec-2] Every JWT in the repo is an anon key');
// A JWT's middle segment is its payload. Decode each one and assert the role.
// This is the check that would have caught a service_role key wearing an
// innocuous-looking name.
const JWTS = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const roles = new Set();
let jwtCount = 0;
for (const [, text] of contents) {
  for (const m of text.match(JWTS) || []) {
    jwtCount++;
    try {
      const payload = JSON.parse(Buffer.from(m.split('.')[1], 'base64url').toString('utf8'));
      roles.add(payload.role || '(no role)');
    } catch (err) { roles.add('(undecodable)'); }
  }
}
check('found the anon key we expect', jwtCount > 0, 'no JWT in the repo at all');
check('and every one of them is role anon',
  [...roles].every(r => r === 'anon'),
  `roles found: ${[...roles].join(', ')}`);

console.log('\n[sec-3] config.js is deployable');
// A gitignored config.js would 404 at the deployed URL: Vercel deploys from the
// repo, so an ignored file simply is not there. The app would never sign in and
// nothing would say why.
check('config.js is tracked', tracked.includes('config.js'),
  'not tracked — the deployed site would 404 on it');
check('config.js is not ignored',
  !/^\s*config\.js\s*$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')),
  '.gitignore still excludes it, so it would not deploy');
const cfg = contents.get('config.js') || '';
check('config.js carries a url and an anonKey',
  /url:\s*'https:\/\/[a-z0-9]+\.supabase\.co'/.test(cfg) && /anonKey:\s*'eyJ/.test(cfg));

console.log('\n[sec-4] The gate cannot brick the app');
const html = contents.get('index.html') || '';
const auth = contents.get('auth.js') || '';
// If auth.js failed to load, a "hidden until auth resolves" class on <body>
// would leave the app permanently hidden with nothing on screen explaining it.
check('the app is not hidden by a class on <body>',
  !/auth-pending/.test(html) && !/auth-pending/.test(auth),
  'a failed auth.js would leave the app invisible');
check('the gate covers the app instead', /\.auth-gate\s*\{[^}]*position:\s*fixed/.test(contents.get('style.css') || ''));
check('and takes it out of the tab order while up',
  /setAttribute\('inert'/.test(auth) && /removeAttribute\('inert'\)/.test(auth));
check('an unconfigured or file:// copy skips the gate entirely',
  /location\.protocol/.test(auth) && /unlock\(\);/.test(auth));
check('the gate markup is hidden by default',
  /class="auth-gate hidden"/.test(html),
  'it would flash on every load');

console.log('\n[sec-5] Load order and isolation');
const order = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
check('scripts load config, library, app, then auth',
  JSON.stringify(order) === JSON.stringify(['config.js', 'vendor/supabase.js', 'app.js', 'auth.js']),
  order.join(' -> '));
check('the auth library is committed, not pulled from a CDN',
  tracked.includes('vendor/supabase.js'),
  'a third-party script would run with access to this page');
check('no third-party script is loaded at runtime',
  !/<script[^>]+src="https?:\/\//.test(html),
  'a remote script can read every local task');
// app.js must stay unaware of auth: it is the file that has to keep working
// from file://, offline, and with no account.
check('app.js does not reference supabase',
  !/supabase/i.test(contents.get('app.js') || ''));
check('the client is exposed for the sync phase to reuse',
  /window\.TM_AUTH\s*=/.test(auth),
  'Phase 3 would open a second client with its own token refresh');

console.log('\n[sec-5b] The password path never sends email');
// Supabase's built-in sender allows about three emails an hour, so a sign-in
// flow that always sends one can lock the only account out during setup. The
// password path has to stand on its own.
check('password sign-in exists', /signInWithPassword\(/.test(auth));
check('account creation exists', /signUp\(/.test(auth));
check('the create button is not offered in link mode',
  /createBtn\)\s*createBtn\.classList\.toggle\('hidden', link\)/.test(auth.replace(/\s+/g, ' ')),
  'it would offer to create an account that already exists');
check('both methods are reachable from the markup',
  /id="auth-tab-password"/.test(html) && /id="auth-tab-link"/.test(html));
check('the password field is never autocompleted as a new one',
  /autocomplete="current-password"/.test(html));
check('a short password is refused before the request',
  /password\.length < 6/.test(auth));

console.log('\n[sec-6] The service worker must not cache credentials');
const sw = contents.get('sw.js') || '';
// A token in a cache key is readable by any later script on the origin.
check('navigations are not cached under their real URL',
  /new Request\(APP_SHELL\)/.test(sw),
  'a magic-link URL carrying a token would be written into Cache Storage');
check('the runtime cache takes static files only',
  /STATIC_EXTENSIONS/.test(sw));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
