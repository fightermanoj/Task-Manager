# Task Manager

A task list, a four-slot focus queue with live timers, and a day schedule —
installable and offline-capable.

Three static files. No build step, no bundler, no framework.

## Run

Open `index.html`, or serve the directory:

```
npx serve .
```

## Test

```
npm install
npm test
```

Six Node scripts under `tests/`, no framework: `app.js` driven against a stub
DOM, the stylesheet's structure, WCAG contrast across all four palettes, offline
sync, the committed-secrets rules, and the PWA shell.

## Notes

Everything the app reads lives in `localStorage` under the `tm_*` keys, so it
works with no network at all. Signing in adds a cloud copy: `sync.js` pushes
changes up and folds back what other devices wrote, in the background, without
the UI ever waiting on it.

`api/keepalive.js` is the one piece of server code, and it does nothing but ask
the database for a single row once a day. A free Supabase project is paused after
seven days with no activity, and a personal task list has quiet weeks — the daily
request is what stops the project going to sleep. If the app ever stops syncing
for no obvious reason, check that first: the project may be paused, and the
dashboard's **Resume project** brings it back with nothing lost.

`npm run icons` regenerates `icons/` from `icon.svg`; the PNGs are committed, so
a deploy never needs it.
