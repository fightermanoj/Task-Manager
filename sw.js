// Service worker for the Task Manager PWA.
//
// Strategy: stale-while-revalidate for the app's own files. The cached copy is
// served immediately (so the app starts instantly and works fully offline), and
// a fresh copy is fetched in the background for next time. A plain cache-first
// worker would pin the app to whatever it saw first; a plain network-first one
// would leave you with nothing on a plane.
//
// Two things this worker deliberately does NOT do:
//   * It does not call skipWaiting() on install. A new worker waits until the
//     page asks for it (see the update prompt in app.js), so a deploy can't
//     swap the app out from under a running focus timer.
//   * It does not touch cross-origin requests. Google Fonts is the only one,
//     and style.css already declares full fallback stacks, so dropping them
//     offline costs nothing. Calling respondWith() there would turn a harmless
//     font miss into a thrown error.

const VERSION = 'tm-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// index.html only — not "/" as well. The two are the same resource, and caching
// both means every deploy fetches and stores it twice. "." is the scope root,
// which is what a deep link or an offline reload actually requests.
const APP_SHELL = './index.html';

// Everything the app cannot start without. auth.js and sync.js belong here and
// not only in the runtime cache: a file that is merely fetched-once is missing
// on the very first offline load, which is exactly when someone opens an
// installed app on a plane.
const CORE = [
  APP_SHELL,
  './style.css',
  './app.js',
  './auth.js',
  './sync.js',
  './manifest.json',
];

// What the runtime cache is allowed to hold. Today this is the icons; the point
// of the allowlist is that it stays that way once the origin serves something
// per-user.
const STATIC_EXTENSIONS = /\.(?:css|js|mjs|json|png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf|txt|webmanifest)$/i;

// Best-effort: a missing icon must not fail the whole install and leave the app
// with no worker at all.
const OPTIONAL = [
  // config.js is deploy-time configuration and vendor/supabase.js is the
  // largest file here by far. Both are optional for the same reason: a missing
  // one must cost the app nothing worse than no sign-in, never a failed install.
  './config.js',
  './vendor/supabase.js',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

const CURRENT_CACHES = [SHELL_CACHE, RUNTIME_CACHE];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(CORE);
    await Promise.all(OPTIONAL.map(url => cache.add(url).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Drop every cache from a previous VERSION. Without this a deploy can keep
    // serving stale JS forever, because nothing ever removes the old cache.
    const names = await caches.keys();
    await Promise.all(
      names.filter(n => !CURRENT_CACHES.includes(n)).map(n => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

// The page asks for the update only when the user accepts the prompt.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// `event` is passed in so the revalidation can be handed to waitUntil. Returning
// the cached copy settles respondWith immediately, and anything not tied to the
// event's lifetime can be killed with the worker before it lands — which is how
// the cache ends up holding a new index.html beside an old app.js. That pairing
// crashes at boot (the renderer dereferences elements the old markup has not got
// yet), and because a boot throw happens before the update prompt is wired, the
// user has no way to accept the new version. The stores themselves are untouched.
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request, { cache: 'no-cache' })
    .then(response => {
      // Opaque and error responses must not overwrite a good cached copy.
      // `type === 'basic'` also excludes a redirected response, which would
      // otherwise be stored under the app's own URL because cache.put keys on
      // the request, not on where the redirect ended up.
      if (response && response.ok && response.type === 'basic') {
        return cache.put(request, response.clone()).then(() => response);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  const response = await network;
  if (response) return response;
  throw new Error(`offline and not cached: ${request.url}`);
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations all resolve to the app shell, so a deep link, a reload and a
  // cold start from the home screen icon all work offline. Without this the
  // offline reload is a browser error page.
  if (request.mode === 'navigate') {
    // A fresh Request, not event.request: the real navigation URL never becomes
    // a cache key, so a future auth callback carrying ?token= or #access_token
    // can never be written into Cache Storage.
    event.respondWith(staleWhileRevalidate(event, new Request(APP_SHELL), SHELL_CACHE));
    return;
  }

  if (CORE.some(path => url.pathname.endsWith(path.replace('./', '/')))) {
    event.respondWith(staleWhileRevalidate(event, request, SHELL_CACHE));
    return;
  }

  // Only static assets reach a cache. An unfiltered fallback is harmless while
  // the origin serves nothing but this app, but the first same-origin API route
  // or auth callback would make it a per-user data cache that is never evicted
  // and can outlive a sign-out. Anything else passes through untouched.
  if (STATIC_EXTENSIONS.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, request, RUNTIME_CACHE));
  }
});
