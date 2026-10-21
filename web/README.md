# Photos (web renderer)

This directory contains the web tree for **Photos**, the offline fork of
[ente](https://github.com/ente-io/ente). It builds the Next.js renderer that
the desktop app loads; it can also run as a plain web app during development,
talking to a local vault backend.

## What's here

- `apps/photos` — the Photos app (the only app in this fork).
- `packages/*` — shared libraries (`base`, `gallery`, `media`, `new`, `utils`,
  `accounts`, `wasm`).
- `packages/base/locales` — the 53 bundled locales (crowdin-compatible).

## Commands

All commands are run from this directory (`web/`):

```bash
npm ci            # install dependencies
npm run dev       # dev server for the web flavor (needs the local backend below)
npm run build     # production build
npm run lint      # eslint + lint-exceptions gate
npm test          # unit tests
```

The desktop renderer build is produced by `desktop/` (`build-renderer`
script), which builds the same Next.js app with `_PHOTOS_IS_DESKTOP=1` so the
app wires itself to the Electron bridge and the local vault backend.

## Local backend

The app stores everything in a local vault served by a museum-compatible
loopback backend (`desktop/src/main/services/local-backend/`). When running
the web flavor in development, start the backend standalone:

```bash
node desktop/scripts/local-backend-standalone.mjs
```

It listens on `http://127.0.0.1:41119` (override with
`PHOTOS_LOCAL_BACKEND_PORT`). See
[docs/PROTOCOL-INTEGRATION.md](../docs/PROTOCOL-INTEGRATION.md) for how this
seam is designed to be replaced by a different backend.

## Attribution

The Simple Maps city dataset (`world_cities.json`) is used for location
search; see its license terms inside the file. This project is a fork of
ente (AGPL-3.0): https://github.com/sh-clock/ente
