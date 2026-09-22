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

const VERSION = 'tm-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// index.html only — not "/" as well. The two are the same resource, and caching
// both means every deploy fetches and stores it twice. "." is the scope root,
// which is what a deep link or an offline reload actually requests.
const APP_SHELL = './index.html';

const CORE = [
  APP_SHELL,
  './style.css',
  './app.js',
  './manifest.json',
];

// Best-effort: a missing icon must not fail the whole install and leave the app
// with no worker at all.
const OPTIONAL = [
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

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then(response => {
      // Opaque and error responses must not overwrite a good cached copy.
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) return cached;

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
    event.respondWith(staleWhileRevalidate(new Request(APP_SHELL), SHELL_CACHE));
    return;
  }

  if (CORE.some(path => url.pathname.endsWith(path.replace('./', '/')))) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
