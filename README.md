# Task Manager

A task list, a max-4 focus queue with live timers, and a day schedule — as an
installable, offline-capable web app.

**Three static files.** No build step, no bundler, no framework. `index.html`,
`style.css` and `app.js` are served exactly as they are on disk. `package.json`
exists only to generate the app icons and run the tests; nothing it installs is
served to a browser.

## Running it

Open `index.html` directly, or serve the directory:

```
npx serve .
```

Everything is stored in `localStorage` under the `tm_*` keys. Opening the file
from disk works fully — the service worker simply does not register, because it
cannot outside a secure origin.

## Installable app

`manifest.json` and `sw.js` make it installable and offline-capable. The worker
uses **stale-while-revalidate** for the app's own files: the cached copy is
served immediately and a fresh one is fetched for next time, so the app starts
instantly offline and still updates itself.

It does **not** call `skipWaiting()` on install. A new worker waits until the
page asks for it, and `app.js` shows a "new version is ready" prompt rather than
reloading on its own — a deploy must not swap the app out from under a running
focus timer.

`vercel.json` disables caching for `sw.js` and `index.html`. This is the rule
that actually matters: if a CDN caches the worker, updates never reach an
installed phone.

## Icons

`icon.svg` is the single source of truth. `npm run icons` regenerates every PNG
in `icons/` from it, including a **maskable** variant — Android crops an icon to
whatever shape the launcher uses, so a non-maskable one loses its corners.
The generated PNGs are committed, so a deploy never depends on this script
having been run.

## Tests

```
npm install     # only needed for the tests and the icons
npm test
```

Four self-contained Node scripts, no test framework:

| Suite | What it proves |
|---|---|
| `tests/app-harness.js` | Loads the real `app.js` against a stub DOM and drives its handlers — date parsing, sorting, timers, migrations, the focus queue, the completed archive. |
| `tests/css-check.js` | Brace balance, `var()` references that nothing defines, tokens defined but never used. |
| `tests/contrast.js` | Resolves the four effective palettes out of `style.css` and checks every ink-on-surface pair against WCAG AA, plus that each section reads as its own surface. |
| `tests/pwa-check.js` | Manifest, service-worker lifecycle, deploy headers, and the head wiring in `index.html`. |

## Theming

Two UI modes (`mode-gui`, `mode-terminal`) × two themes (`theme-light`,
`theme-dark`) applied as classes on `<body>`. That makes **four** effective
palettes, and every colour token has to be verified against all four — a value
that passes in one can fail badly in another. `tests/contrast.js` does this
mechanically rather than by eye.

Colours are split by job:

- `--accent-*` — ink drawn on the page.
- `--fill-*` + `--on-fill` — a saturated surface with text on it.

The split exists because a colour that works as ink usually does not work as a
fill: dark-mode blue `#58a6ff` is perfectly readable as text on a dark page, but
white text on it is 2.53:1.
