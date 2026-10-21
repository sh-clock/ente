# Photos

Standalone, offline-first photos app with on-device ML (face detection,
semantic search, OCR). Fork of [ente](https://github.com/ente-io/ente)
trimmed down to a single product: no accounts service, no cloud sync, no
telemetry.

> **Protocol scaffold**: this fork is structured for later insertion into
> the Encrypted Clock Ecosystem wire protocol (v4.1, the "era B uploader"
> role). See [docs/PROTOCOL-INTEGRATION.md](docs/PROTOCOL-INTEGRATION.md)
> for the full integration map — crypto primitives, endpoint mapping,
> upload commit order, and the must-build checklist.

## What's inside

| Path | What it is |
| --- | --- |
| `mobile/apps/photos` | Flutter app (Android) |
| `mobile/apps/locker` | Flutter app (Android) — document locker |
| `web/apps/photos` | Photos UI (Next.js). Also the desktop renderer. |
| `desktop/` | Electron desktop shell (Windows, Linux) |
| `rust/` | Rust core: ML (ONNX), metadata, vector DB, crypto bindings (frb / napi / wasm) |

## Build

- Desktop (Electron): see `desktop/README.md`
- Android (Flutter): see `mobile/apps/photos`
- Web UI: `cd web && npm run build:photos`

## License

AGPLv3 (see [LICENSE](LICENSE)). Copyright retained from the upstream ente
project.
