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
check('scripts load config, library, app, auth, then sync',
  JSON.stringify(order) === JSON.stringify(['config.js', 'vendor/supabase.js', 'app.js', 'auth.js', 'sync.js']),
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
// Fetched-once is not the same as precached: a file that only ever lands in the
// runtime cache is missing the first time the app is opened with no network,
// which is exactly when an installed app gets opened.
check('the shell precaches the scripts it cannot start without',
  /'\.\/auth\.js'/.test(sw) && /'\.\/sync\.js'/.test(sw),
  'a first offline load would start with no sign-in and no sync');

console.log('\n[sec-7] Remember me cannot quietly remember you');
// The failure that matters is unchecking the box and being signed in anyway on
// the next visit, because a copy of the session was left where it would be
// found. Everything here is about the session existing in exactly one place.
check('the control exists and defaults to remembered',
  /id="auth-remember"/.test(html) && /id="auth-remember"[\s\S]{0,40}checked/.test(html));
check('the session is stored under a key we control',
  /storageKey:\s*SESSION_KEY/.test(auth),
  'the library would choose its own name and we could not move it reliably');
check('every key sharing that prefix moves together',
  /function sessionKeys/.test(auth) && /indexOf\(SESSION_KEY\) === 0/.test(auth),
  'the PKCE code verifier shares the prefix and would be stranded');
check('the session is taken out of the other store, not just copied',
  /function settleSessionStore/.test(auth) && /drop\.removeItem\(key\)/.test(auth));
check('and every write clears the other store',
  /storeFor\(!wantsRemember\(\)\)\.removeItem\(key\)/.test(auth));
check('no stored preference means remembered, as before this existed',
  /!== '0'/.test(auth));
check('the password itself is never persisted',
  !/setItem\([^,]*,[^)]*password/i.test(auth),
  'a password in localStorage is readable by any script on this origin');

console.log('\n[sec-8] Sync cannot break the app or lose a local edit');
const sync = contents.get('sync.js') || '';
check('sync.js is shipped', sync.length > 0);
check('it is inert without a config, a client or a real origin',
  /if \(!cfg \|\| !cfg\.url \|\| !client \|\| !TM/.test(sync));
check('app.js still cannot reach the account layer',
  !/TM_AUTH|supabase/i.test(contents.get('app.js') || ''),
  'app.js must keep working with no account, offline, and from file://');
check('the observer app.js exposes stays generic',
  /setPersistObserver/.test(contents.get('app.js') || ''));
check('deletes are tombstones, never hard deletes',
  /deleted_at/.test(sync) && !/\.delete\(\)/.test(sync),
  'a hard delete cannot be propagated — the other device re-uploads the row');
check('an unpushed local edit outranks the server copy',
  /pending\.has\(id\)/.test(sync));
check('the client supplies updated_at',
  /updated_at:\s*stamp/.test(sync));
check('the pull keeps tombstones',
  /select\('\*'\)/.test(sync),
  'filtering deleted rows out means a delete can never be learned about');

console.log('\n[sec-9] The schema cannot invert last-write-wins');
const schema = contents.get('sql/schema.sql') || '';
check('no updated_at trigger on tasks', !/tasks_set_updated_at/.test(schema),
  'it records arrival time, so the oldest offline edit wins every conflict');
check('none on task_groups either', !/task_groups_set_updated_at/.test(schema));
check('profiles keeps its trigger', /profiles_set_updated_at/.test(schema));
check('the group index is not partial',
  /unique index if not exists task_groups_user_name_key[\s\S]{0,90}\(user_id, name\);/.test(schema),
  'PostgREST cannot name a partial index as an upsert target');
const migration = contents.get('sql/phase3.sql') || '';
check('the migration drops both triggers for an existing project',
  /drop trigger if exists tasks_set_updated_at/.test(migration) &&
  /drop trigger if exists task_groups_set_updated_at/.test(migration),
  'schema.sql alone cannot undo a trigger it no longer declares');
check('and rebuilds the index',
  /create unique index if not exists task_groups_user_name_key/.test(migration));

console.log('\n[sec-10] Reminders work on the devices this app is for');
const app = contents.get('app.js') || '';
// These checks are about code, but the strings they look for also appear in the
// comments explaining why neither is used — `// not \`new Notification()\`` and
// `// no VAPID keys and no subscriptions table`. Matching prose would flag the
// documentation for the decision as a violation of it, which is how a check
// ends up being ignored. Strip comments first, then look.
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const sqlOnly = (src) => src.replace(/^\s*--.*$/gm, '');
const appCode = codeOnly(app);
const swCode = codeOnly(sw);
const syncCode = codeOnly(sync);

// new Notification() throws `Illegal constructor` on Android Chrome and does
// not exist at all in an installed iOS PWA — the two devices this feature
// exists for. The registration path is the only one that works on both, so the
// constructor appearing even once is the feature silently not working.
check('the notice goes out through the service worker registration',
  /\.showNotification\(/.test(appCode));
check('the constructor that throws on mobile is never used',
  !/new Notification\(/.test(appCode),
  'it fails on Android Chrome and is undefined on an installed iOS PWA');
// A request made on load is rejected or silently ignored, and once denied the
// API never prompts again, so the button is the only route in.
check('the permission prompt is inside the click handler',
  /async function toggleReminders[\s\S]*?Notification\.requestPermission\(\)[\s\S]*?\n\}/.test(appCode),
  'a request made at load would be ignored, and denial is permanent');
check('a denied permission is surfaced rather than offered as a dead click',
  /permission\s*===\s*'denied'/i.test(appCode) && /blocked/i.test(appCode));
check('duplicate notices collapse onto one tag', /tag:\s*`task-\$\{/.test(appCode));
check('a fired reminder is recorded, so it cannot fire twice',
  /FIRED_KEY/.test(appCode) && /fired\[key\]/.test(appCode));
check('the click is routed back to the task it is about',
  /REMINDER_CLICKED/.test(swCode) && /REMINDER_CLICKED/.test(appCode),
  'a click is delivered to the worker, so dropping it loses the tap');
// Reminders are client-side only by decision: no Edge Function, no VAPID, no
// subscription table. Any of these appearing in code means that decision was
// undone somewhere without the rest of it following.
check('no server-side push machinery was introduced',
  !/push_subscriptions|VAPID|web-push|applicationServerKey/i.test(
    [appCode, swCode, syncCode, sqlOnly(contents.get('sql/schema.sql') || '')].join('\n')),
  'client-side reminders need no server state');
// And independently: the schema really has no subscription table.
check('the schema has no subscription table',
  !/create table[^;]*push_subscriptions/i.test(sqlOnly(contents.get('sql/schema.sql') || '')));

console.log('\n[sec-11] Nothing is fetched from a third party');
const css = contents.get('style.css') || '';
// The app used to take its typefaces from Google Fonts. That was the only
// cross-origin request it made, it made the first paint wait on a DNS lookup
// plus a round trip, and offline it silently swapped the typeface — most
// visible in terminal mode, where the monospace grid is the whole design.
check('the fonts are served from this origin',
  /@font-face\s*\{[^}]*src:\s*url\('fonts\//.test(css),
  'no self-hosted @font-face rule');
check('every font file it names is actually present',
  [...css.matchAll(/url\('(fonts\/[^']+)'\)/g)].map(m => m[1])
    .every(p => tracked.includes(p)),
  'a @font-face points at a file that would 404');
check('both families and all four weights are covered',
  ['Fira Code', 'Inter'].every(f =>
    [400, 500, 600, 700].every(w =>
      new RegExp(`font-family:\\s*'${f}'[^}]*font-weight:\\s*${w}`).test(css))),
  'a weight the sheet asks for would be synthesised or substituted');
check('the Google Fonts stylesheet link is gone',
  !/fonts\.googleapis\.com/.test(html), 'index.html still links a remote stylesheet');
check('and its preconnects went with it',
  !/fonts\.gstatic\.com/.test(html) && !/<link[^>]+rel="preconnect"/.test(html),
  'a preconnect to a host nothing is fetched from is a wasted connection');
// With no remote stylesheet there is no external stylesheet origin left, and
// with no remote script there is no external script origin — which is what
// makes a same-origin-only policy possible at all.
check('the app makes no cross-origin request at all',
  !/https?:\/\//.test(html.replace(/https:\/\/task-manager[^\s"']*/g, '')) &&
  !/url\(\s*['"]?https?:/.test(css),
  'something in the markup or sheet is still fetched from another host');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
