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

Four Node scripts under `tests/`, no framework: `app.js` driven against a stub
DOM, the stylesheet's structure, WCAG contrast across all four palettes, and the
PWA shell.

## Notes

Everything lives in `localStorage` under the `tm_*` keys. There is no server and
no account.

`npm run icons` regenerates `icons/` from `icon.svg`; the PNGs are committed, so
a deploy never needs it.
