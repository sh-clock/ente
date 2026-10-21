# Photos desktop release process

This fork ships as standalone, offline builds. There is **no auto-update**:
the app does not check any update feed, and artifacts are not published to any
external release repository.

## Building artifacts

Builds are produced manually from a checkout (see [README](../README.md)):

```sh
npm run postinstall
npm run build
```

electron-builder writes the artifacts configured in
[electron-builder.yml](../electron-builder.yml) — a `zip` (Windows), and
`AppImage`/`.deb`/`.rpm`/`.pacman` packages (Linux) — into `dist/`, named
`Photos-<version>-<arch>.<ext>`. Distribute them however you like; nothing in
the app phones home or updates itself.

## In-app "What's new"

For a release with user-facing changes, update
[WhatsNew.tsx](../../web/apps/photos/src/components/WhatsNew.tsx) and bump
`changelogVersion` in [changelog.ts](../../web/apps/photos/src/services/changelog.ts)
on `main` before cutting the build.

The dialog shows once when the installed `changelogVersion` is newer than the
one the user last saw.

## ML models

The ML models are not bundled. Online installs download them automatically
from the public models.ente.com CDN on first ML enable (~251 MB: CLIP image +
text, face detection + embedding). For offline installs, fetch them with
[download-models.cmd](../../download-models.cmd) (see its header for
re-hosting notes) and pre-seed `<userData>/assets/models`.
