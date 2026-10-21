# PROTOCOL-INTEGRATION — Photos fork ↔ Protocol v4.1 ("Encrypted Clock Ecosystem")

Definitive integration map for swapping the fork's loopback museum backend for the
clock-protocol server (spec: `protocol-v4.1.txt`, referenced below as "§").
All file paths/line numbers verified on branch `surgery/05-deep-fix` @ `0cc189da6b`;
**refreshed @ `4decf4e107`** (post whole-repo audit batch 13 — see the
"Refresh 2026-10-21" block below for the corrections and
`docs/PROTOCOL-v4.2-PROPOSAL.md` for the protocol-side changes that follow
from this map).

---

## Refresh 2026-10-21 (post batch-13 audit; supersedes stale line refs below)

The audits (13-a..13-g) re-verified every crypto row of §2 byte-exact and found
the architecture claims unchanged. Material corrections to the tables below:

1. **Sizes drifted** (both files grew, all offsets shifted): `server.ts` is
   ~1,470 lines (was 1,126); `store.ts` ~530 (was 322). Line citations in
   §1/§3/§4 are pre-growth; use route names, not line numbers, until re-stamped.
2. **§4 route map was missing live rows** (now in the table, not previously
   mapped): `GET /collections/{id}` (live via `trash.ts:70`), `POST
   /users/logout` (fire-and-forget), the v3 download/thumbnail call sites in
   `packages/base/file-download.ts`, and the `PUT /files/video-data` +
   preview-upload-url HLS family. Dead rows confirmed dead: sharing ×6,
   `user.ts` ×6, billing ×6, public/cast/file-link — zero callers.
3. **`user-details`**: 8 -> 6 calls; the route is now 100% dead in local mode.
4. **§5 erratum**: the multipart threshold is **> 16 MiB** (> 4 chunks), not
   "< 20 MiB"; the proxy-vs-multipart decision is `upload-service.ts` chunk
   count, parts are 5×4 MiB.
5. **New security layer since 0cc189da6b** (must appear in any bridge spec):
   all blob-write URLs are **HMAC-presigned** (sha256-derived secret, 24 h
   expiry, timing-safe compare) — 12 mint sites / 7 transport routes sign,
   5 write routes verify; `/trash` routes now distinguish `isRestored` rows
   and honor the `lastUpdatedAt` cutoff; `POST /files` synthesizes
   `info.fileSize`; every file-row mutation (copy, magic-metadata) bumps the
   owning collection's `updationTime`; `/files/trash` accepts the client's
   `{items:[{fileID,collectionID}]}` shape; `/blobs/{key}` validates 32-hex
   keys; vault state.json is fsync'd with a `.bak` generation and refuses
   silent resets; `nowMicros` is seeded across restarts.
6. **Bridge laws**: the full 28-law inventory lives in audit `13-c` (M3);
   the condensed 11 that bind the protocol side are codified in
   `PROTOCOL-v4.2-PROPOSAL.md` §23.3.
7. **Mobile** is a third client candidate (audit `13-e` M4): seams ready
   (dart-define/runtime `setEndpoint`, X-Auth-Token, cleartext loopback
   permitted, on-device NaCl); a mobile bridge needs the same §23 profile.

---

## 1. Architecture overview — where the seam is

```
Renderer (Next.js, web/apps/photos/src/pages/gallery.tsx)
  │  pullFiles() every 5 min + on desktop focus   (apps/photos/src/services/pull.ts:36-72)
  ▼
Client services — museum-shaped, direct fetch() calls:
  web/packages/new/photos/services/collection.ts   (23 apiURL() calls: /collections*, /files/copy…)
  web/packages/gallery/services/upload/remote.ts   ( 8: /files/upload-url(s), /multipart-*, /files)
  web/packages/gallery/services/file-data.ts       (10: /files/data*, /files/video-data)
  web/packages/new/photos/services/{trash,file}.ts ( 4: /trash/*, /files/*-magic-metadata)
  web/packages/new/photos/services/remote-store.ts ( 3: /remote-store*)
  web/packages/new/photos/services/user-entity/remote.ts (6: /user-entity/*)
  web/packages/new/photos/services/user-details.ts ( 8: /users/details/v2 — dead in local mode)
  ▼
Transport helpers (the ONLY transport-level seam):
  web/packages/base/origins.ts  — apiOrigin()/apiURL()/uploaderOrigin()
  web/packages/base/http.ts     — authenticatedRequestHeaders() => {"X-Auth-Token": …} (http.ts:8-9)
  ▼
Loopback server: desktop/src/main/services/local-backend/server.ts (1,126 lines, node:http)
  started by desktop/src/main.ts:87 startLocalBackendIfNeeded(userDataDir)
  (port 41119, tries +9; origin exposed to renderer via IPC "localAPIOrigin",
   desktop/src/main/ipc.ts:139-140; standalone runner: desktop/scripts/local-backend-standalone.mjs)
  ▼
LocalVaultStore: desktop/src/main/services/local-backend/store.ts (322 lines)
  userData/local-vault/state.json (JSON, 300ms-debounced flush) + blobs/{objectKey}
```

**Seam cleanliness verdict — split verdict:**

| Layer | Cleanliness | Evidence |
|---|---|---|
| Base URL / origin | **CLEAN** | Single 51-line file `web/packages/base/origins.ts`. `apiOrigin()` = KVS `apiOrigin` → build-env `buildEnvCustomAPIEndpoint` → `localAPIOrigin()` (origins.ts:19-39). Pointing the app at ANY http(s) server is a one-KVS-set + no rebuild. `uploaderOrigin()` follows the same chain (origins.ts:50-51). |
| Auth header | **CLEAN** | One function `authenticatedRequestHeaders()` (base/http.ts:8-9) adds `X-Auth-Token`. Protocol needs `Authorization: Bearer <hex64>` — one-file change. |
| API surface | **SCATTERED** | Museum semantics are baked into 7+ live service modules (23 calls in collection.ts alone; accounts/srp/passkey calls are dead in local mode). There is no `ApiClient` interface to reimplement; each service knows museum routes. |

**Two integration strategies** (the doc takes no sides, but notes effort):
- **A. Museum→protocol bridge server** (recommended for minimal surgery): keep the entire client untouched; replace `local-backend/server.ts` with a `protocol-backend` server that speaks the museum surface but persists via protocol routes (`/rows`, `/blob/*`). The loopback server is already a pure translation layer with zero client knowledge beyond museum shapes.
- **B. Native protocol client**: new `ProtocolBackend` service package replacing the museum services listed above. Large surgery (collection.ts is 1,558 lines), but eliminates museum semantics long-term.

---

## 2. Crypto inventory vs protocol §15

All fork crypto lives in `web/packages/base/crypto/libsodium.ts` (JS path) and
`rust/crates/core/src/crypto/{secretbox,stream,blob,argon,kdf}.rs` (wasm/native path).

| # | Purpose | Fork primitive (exact site) | Protocol §15 | Verdict |
|---|---|---|---|---|
| a | **Thumbnail bytes** | **secretstream XChaCha20-Poly1305**, single push + `TAG_FINAL`; 24B header stored separately as `thumbnail.decryptionHeader`. `encryptBlobBytes()` libsodium.ts:83-104; called at upload-service.ts:1171 | §15.2 **secretbox XSalsa20-Poly1305**, body = `nonce(24B) ‖ ct`, pt ≤ 256KiB | **MISMATCH (cipher)**. ente seals thumbnails with secretstream, protocol wants secretbox. |
| b | **Original file bytes** | **secretstream XChaCha20-Poly1305**, chunked: `initChunkEncryption` + `encryptStreamChunk` (libsodium.ts:165-192), chunk size **4MiB** (`streamEncryptionChunkSize`, base/crypto/types.ts:6), +17B/frame, FINAL tag on last chunk; 24B header separate. Rust mirror: `ENCRYPTION_CHUNK_SIZE = 4*1024*1024` (crates/core/src/crypto/stream.rs:20) | §15.3 same cipher, **1MiB** chunks, chunk 0 body = `header(24B) ‖ ct` | **PRIMITIVE MATCHES, CHUNKING DIFFERS** (4MiB vs 1MiB; header placement: separate row field vs inline chunk 0). |
| c | **Per-file key (K_photo)** | `generateBlobOrStreamKey()` = `crypto_secretstream_xchacha20poly1305_keygen` (libsodium.ts:61-64; upload-service.ts:1142) — 32B random per file | §15.1 K_photo 32B random per photo | **MATCH** (concept + size). |
| d | **File-key wrapping** | `encryptBox(fileKey, collectionKey)` = secretbox XSalsa20-Poly1305, random 24B nonce (upload-service.ts:1192; libsodium.ts:66-81); stored as `encryptedKey`+`keyDecryptionNonce` row fields | §15.1 AES-256-GCM under K_wrap, **deterministic** nonce = HKDF(K_wrap, info=`"clock-v4/K_photo_nonce"‖uid`) 12B, AAD = `"kp:"+uid`, 48B, stored **inside the index entry** | **MISMATCH (wrap cipher + key + storage)**. New wrap/unwrap module needed; K_photo values themselves carry over. |
| e | **Collection keys** | 32B random (`generateKey()`), wrapped `encryptBox(collectionKey, masterKey)` (collection.ts:94-98); name also secretbox under collectionKey | No collection concept; closest is K_wrap (HKDF subkey of AES1) | **NO EQUIVALENT** — protocol is single-stream. |
| f | **Master key / KEK** | Local vault: random 32B masterKey (local-vault.ts:132), persisted via OS safeStorage + localforage fallback (local-vault.ts:38-70); KeyAttributes kek fields are **placeholders** (local-vault.ts:86-101, `TODO(protocol)` comment lines 3-8). Full-ente path (inactive): **Argon2id13** `authDeriveKek` (prelogin wasm → rust/crates/core/src/crypto/argon.rs:91-97) | §3 PASSWORD → **PBKDF2-HMAC-SHA256** (100k iters) → KEK → AES1 → HKDF-SHA256 subkeys | **MISMATCH by design** — see §15.5 quote in section 6. |
| g | **File metadata JSON** | `encryptMetadataJSON` = secretstream under fileKey (libsodium.ts:120-124; upload-service.ts:1178) | Only bucket-entry fields (bytes, taken_ts, sha16, flags) | **NO EQUIVALENT** (stays local or in a new row type). |
| h | **User-entity payloads** (ML cgroups, location tags) | per-type key `generateBlobOrStreamKey` wrapped `encryptBox(key, masterKey)`; payload secretstream + gzip (user-entity/index.ts:1-30) | Generic AES-GCM rows would be the only home | **NO EQUIVALENT** (stay local). |

**Thumbnail/preview good news:** the exact §15.2 body format already exists in the codebase twice:
`encryptBox` (libsodium.ts:66-81, `crypto_secretbox_easy`, 24B nonce, +16B MAC) and rust
`secretbox::encrypt_combined` (crates/core/src/crypto/secretbox.rs:63-72 — comment: *"prepending the nonce is
an Ente convention"*), which is literally `nonce(24B) ‖ ct`. Thumbnail budget (720px long edge,
JPEG q≤0.7, ≤100KiB — gallery/services/upload/thumbnail.ts:14-15) fits §15.2's 256KiB cap with 2.6× headroom.

**What a protocol adapter must do (crypto):**
1. Re-seal previews with secretbox (trivial — swap `encryptBlobBytes` → `encryptBox`/`encrypt_combined` at the protocol boundary; thumbnails are regenerated client-side anyway).
2. Re-chunk originals at 1MiB with header inlined into chunk 0 (same secretstream push API, different feed size; or re-seal at protocol upload time and keep 4MiB locally — bytes on the protocol wire must be 1MiB-chunked per §2 CHUNK_PT_MAX).
3. Add a K_photo wrap/unwrap module: AES-256-GCM(K_wrap, HKDF-derived nonce, K_photo, AAD "kp:"+uid) → 48B for the bucket entry (§15.1). WebCrypto AES-GCM suffices.
4. sha16 = sha256(plaintext)[0:8] over the original at seal time (fork currently computes MD5 base64 for multipart checksums and generichash for chunk hashes — different digests, easy addition).

---

## 3. Data model map

| local-vault (store.ts) | museum API object (client schema) | protocol v4.1 concept | Notes |
|---|---|---|---|
| `StoredCollection` (store.ts:14-30) | `RemoteCollection` (ente-media/collection.ts) | **none** — photo_index is a single global stream | Albums could become future non-P row types (§22 additive) or stay local |
| `StoredFile` (store.ts:32-46) | `RemoteEnteFile` (ente-media/file.ts:66-81) | photo_index entry (§16) + R2 blobs | See field table below |
| `file.{objectKey,decryptionHeader,size}` | ditto | `PUT /blob/orig/{uid}/{n:04d}` chunks; size → entry `bytes u32` | objectKey is 32-hex (16B, store.ts:162-164); protocol uid is 12B raw / 24-hex (§2) |
| `thumbnail.{objectKey,decryptionHeader,size}` | ditto | `PUT /blob/pv/{uid}` (§15.2 body) | permanent in R2 (`p/{uid}.pv`) |
| `encryptedKey`+`keyDecryptionNonce` | ditto | `k_wrapped` 48B **inside the index entry** | replaces both fields; AAD-bound to uid |
| — (none) | — | `sha16` (8B), `taken_ts` (u32, EXIF), `flags` (bit0 tombstone), bucket `hdr`/`ver` | no local equivalent today |
| `updationTime` (epoch **micros**, store.ts:148-152) | same field drives diffs | envelope `ver` u32 monotone (§6) | different mechanism: fork = sinceTime pagination; protocol = ver RMW arbitration |
| `metadata` (encrypted JSON: title, lat/lng, fileType…) | `RemoteFileMetadata` | **none** (only bytes/taken_ts/sha16/flags) | stays local or future row type |
| `magicMetadata`/`pubMagicMetadata` (file + collection) | same | **none** | local only |
| `sharees`, `publicURLs`, `sharedMagicMetadata` | same | **none** (single user, §1) | dead weight in protocol world |
| `info` (file row), `fileData` map (PUT /files/data) | file-data service | **none** | local only |
| `videoData` (HLS playlists) | /files/video-data | **none** | local only |
| `trash: StoredTrashItem[]` (30-day retention, server.ts:37) | /trash/v2/diff | entry `flags bit0` tombstone in bucket RMW (§16) | protocol tombstones replicate via row sync; purge on bucket compaction |
| `collectionTombstones` (store.ts:212-227) | /collections/v2/diff `isDeleted` rows | same tombstone bit | per-collection removal has no protocol meaning (no collections) |
| `remoteStore` map | /remote-store (settings: `mapEnabled`, `customDomain`, ML flag `faceSearchEnabled`) | **none** | client-side KV or future row type |
| `userEntities`/`userEntityKeys` | /user-entity (types `location`, `cgroup`) | **none** (rows would need new types) | ML people data — see §8 |
| `nextCollectionID`/`nextFileID` | server-allocated ids | uid 12B random (uploader-generated) | id allocation moves client-side |
| — | — | `staged` set + `photo_pending` (§7, §10), ack journal (§18) | entirely new concepts |

---

## 4. Endpoint map (museum → protocol)

From server.ts routes (all `handle()` branches, server.ts:176-1011) + client call sites.

| Museum endpoint (client site) | Protocol equivalent | Transformation |
|---|---|---|
| `POST /files` — commit new file (remote.ts:297 postEnteFile) | `PUT /rows/P{yyyymm}` RMW bucket (§16) | append 80B entry (uid, sha16, bytes, taken_ts, flags, k_wrapped) into 40,976B fixed plaintext; ver = bucket ver + 1; rebase on rejection (§9) |
| `GET /files/upload-urls` / `POST /files/upload-url` (remote.ts:21-50) | none needed | protocol blob routes are deterministic (`/blob/pv/{uid}`, `/blob/orig/{uid}/{n}`); drop URL fetch |
| `GET/POST /files/multipart-upload-url(s)` (remote.ts:75-142) | `PUT /blob/orig/{uid}/{n:04d}` per 1MiB chunk | each protocol chunk is its own R2 object; no XML completion, no 20MiB parts |
| `PUT /file-upload`, `PUT /multipart-upload`, `POST /multipart-complete` (worker proxies, remote.ts:171-279) | direct `PUT /blob/*` with `Authorization: Bearer` | proxy can stay for CORS/streams, but header set changes |
| `GET /files/download/v3/{id}`, `/files/thumbnail/v3/{id}` (returns blob URL) | `GET /blob/orig/{uid}/{n:04d}`, `GET /blob/pv/{uid}` | per-chunk fetch + secretstream pull; **no Range support in protocol** |
| `GET /blobs/{objectKey}` (Range 206, server.ts:270-273, 1084-1125) | `GET /blob/*` (full body per chunk) | chunk index = natural range unit; reassemble for video seek |
| `GET /collections/v2` + `GET /collections/v2/diff` (collection.ts:199, 291) | `GET /rows` manifest + `GET /rows/P*` decrypt buckets | collections themselves have **no equivalent — stays local** (or future row types) |
| `POST /collections` / `/rename` / magic-metadata ×3 / `add-files` / `restore-files` / `move-files` / `v3/remove-files` / `DELETE /collections/v3/{id}` (collection.ts:139-1093) | none (album ops) | local-only; only "delete photo" maps to bucket tombstone RMW |
| `POST /files/trash`, `/trash/delete`, `/trash/empty`, `GET /trash/v2/diff` (collection.ts:756, trash.ts:110-142) | bucket RMW setting `flags bit0` (§16) | trash-view can be a client-side filter on tombstoned entries; no 30-day server retention concept |
| `POST /files/copy` (collection.ts:591) | none | same K_photo, new uid + new entry (dedupe client-side) |
| `PUT/POST /files/magic-metadata`, `/files/public-magic-metadata` (file.ts:90,132) | none | stays local |
| `PUT /files/data`, `POST/GET /files/data/fetch`, `/files/data/status-diff`, `/files/data/preview*`, `PUT /files/video-data` (file-data.ts) | none | stays local |
| `GET/POST /remote-store`, `/remote-store/feature-flags` (remote-store.ts; server.ts:869-904) | none | stays local (settings + ML flag) |
| `GET/POST /user-entity/key`, `/user-entity/entity/diff|POST|PUT|DELETE` (user-entity/remote.ts) | none today; could be additive row types (§22) | stays local first |
| `GET /users/session-validity/v2` (server.ts:1004-1007) | none — closest is `GET /config` (§8) | must NOT silently-404 into a logout loop (see §8 risks) |
| `GET /users/details/v2` (user-details.ts:143) | none | dead in local mode; keep local |
| `GET /collection-actions/pending-remove` (server.ts:533) | none | always empty already |
| `POST /photo/ack` — **new** (§17) | clock-side concept; fork (AUTH_UI) may ack in tests | fork never acks in normal operation — it is the uploader |
| `GET /status`, `GET /ws`, `GET /version` — **new** | optional UI conveniences (photo_pending display) | |

---

## 5. Upload commit order comparison

Fork today (`upload-service.ts`):
1. `encryptFile()` (upload-service.ts:1137-1204): fileKey ← secretstream keygen; original → 4MiB secretstream chunks; thumbnail → single-shot secretstream; metadata/pubMagicMetadata → secretstream; **fileKey wrapped under collectionKey (secretbox)**.
2. `uploadToBucket()` (1309-1419): **original first** — single PUT via worker proxy if < 5 chunks (<20MiB), else multipart (5×4MiB parts, `multipartChunksPerPart = 5`, line 92); **then** thumbnail PUT.
3. `createRemoteFile()` → `POST /files` (1664-1672) — the museum row is the commit record.
4. Async post-steps: file-data info, ML live indexing (`indexNewUpload`, ml/index.ts:190-199).

Protocol §17 order: `seal → PUT pv → PUT orig chunks 0..N → RMW bucket (PUT /rows/P{yyyymm}) → [clock pulls, acks] → staging deleted`.

| Aspect | Fork | Protocol | Adapter work |
|---|---|---|---|
| Byte order | original → thumbnail | **preview → originals** | reorder (trivial) |
| Commit record | `POST /files` (server assigns id + updationTime) | bucket row RMW (client builds 80B entry, manages ver) | insert RMW after last chunk PUT; crash-before-commit leaves reclaimable staging (14d sweep §19) — no orphan rows possible |
| Idempotency | objectKey PUTs retry-safe, but `POST /files` retry can duplicate a row (client dedups by `metadataHash`) | uid-keyed PUTs are "idempotent same-key overwrites" (§17); RMW rejected unless ver > stored (silent rebase, §9) | strictly better; drop dedup-by-hash |
| Key location | wrapped key in museum row | k_wrapped inside bucket entry | same commit point |
| Post-commit | none | ack by clock deletes orig staging (`p/{uid}/{n}` gone; `p/{uid}.pv` permanent) | fork must treat local vault (not server) as the original's home — see §8 |

---

## 6. Key hierarchy delta

```
FORK (local vault, local-vault.ts):
  random 32B masterKey ── OS safeStorage / localforage (no password today)
  ├─ secretbox-wrap → collectionKey(s)
  │                  └─ secretbox-wrap → fileKey (K_photo)
  Full-ente (inactive): Argon2id13(keccak…) → KEK → masterKey   (argon.rs:91-97)

PROTOCOL §3:
  PASSWORD(≥40ch) → PBKDF2-HMAC-SHA256(salt,100k) → KEK
    → unwraps AES1 (32B, wrap in config row, GET /config)
      → HKDF-SHA256(ikm=AES1, salt="", info="clock-v4/<domain>")
          K_data (rows/buckets), K_wrap (K_photo wrap), K_c2u (WS), AUTH_UI, AUTH_CLOCK
```

Mapping: `masterKey ≈ AES1`; `fileKey ≈ K_photo` (identical role); `collectionKey` has no protocol role.
New code needed: PBKDF2 + HKDF derivation at unlock (WebCrypto, ~50 lines), AES1 unwrap from
`GET /config`, K_wrap wrap/unwrap (§15.1), bearer tokens from HKDF info strings.

Protocol §15.5 explicitly permits keeping the fork's KDF (quoted verbatim):

> "15.5 Argon2id: NOT used on the wire. ente fork internals may keep Argon2id
> where its own code expects it (local vault derivation); the protocol
> depends only on secretbox + secretstream. Our KDF remains PBKDF2-SHA256
> (§3) — one KDF decision, made once."

The fork anticipates this: `local-vault.ts:3-8` — "This will later be replaced by the clock
protocol's password-derived vault (PASSWORD -> KEK -> master key) … TODO(protocol): replace
with password-based vault bootstrap."

---

## 7. Scaffold readiness checklist (ordered)

| # | Item | Size | Plugs into | Copy from |
|---|---|---|---|---|
| 1 | `ProtocolConfig` service: PBKDF2→KEK→AES1→HKDF subkeys + `GET /config` + bearer storage | S | new `web/packages/base/protocol/` | local-vault.ts structure; WebCrypto |
| 2 | Swap auth header `X-Auth-Token` → `Authorization: Bearer <hex64>` behind a flag | S | `web/packages/base/http.ts:8-9` | — |
| 3 | `K_photo` wrap/unwrap module (AES-256-GCM, HKDF nonce, AAD "kp:"+uid, 48B) + tests | S | alongside base/crypto | libsodium.ts patterns; WebCrypto AES-GCM |
| 4 | Preview sealer: secretbox `nonce‖ct` (§15.2) | S | upload boundary | `encryptBox` (libsodium.ts:66-81); rust `secretbox::encrypt_combined` (secretbox.rs:64) |
| 5 | 1MiB secretstream re-chunker with header-in-chunk-0 (§15.3) + tests | M | upload boundary | `initChunkEncryption`/`encryptStreamChunk` (libsodium.ts:165-192); `CryptoStreamEncryptor` (wasm lib crypto/file.rs:10-47) |
| 6 | Bucket codec: encode/decode 40,976B buckets (hdr 16B "PIDX" + 512×80B entries), overflow rows `P{yyyymm}-2`, tombstone flags, zero-padding; tests | M | new module; strategy A puts it in the bridge server | store.ts serialization discipline |
| 7 | Row-envelope codec: AES-256-GCM(K_data, nonce12, pt, AAD=id‖ver) + ver/RMW rebase loop | M | new module | §6 spec; existing retry helpers (`retryAsyncOperation`, base/http.ts) |
| 8 | `taken_ts` extraction: EXIF DateTimeOriginal → u32 (gallery/services/exif.ts already parses it into `metadata.creationTime`); fallback mtime; 0 if unknown | S | upload boundary | exif.ts:39-41 |
| 9 | sha16 = sha256(plaintext)[0:8] at seal time | S | upload boundary | etagFor (server.ts:1015) shows the digest pattern |
| 10 | uid generator (12B random, hex24 on routes) + uid↔fileID mapping table | S | upload boundary | `newObjectKey()` (store.ts:162-164) |
| 11 | Protocol upload pipeline: seal → PUT pv → PUT orig 0..N → RMW bucket; per-photo retry idempotent by uid | M | new `uploadProtocol.ts`; or bridge server translating `POST /files` | uploadToBucket (upload-service.ts:1309-1419) shape |
| 12 | Pull path: `GET /rows` manifest → fetch changed `P*` buckets → decrypt → synthesize `RemoteEnteFile`-shaped rows for the existing client (strategy A) or new local cache (strategy B) | L | strategy A: bridge server's `/collections/v2/diff` + `/trash/v2/diff` implementations; strategy B: pull.ts | pullCollectionFiles (collection.ts), store diff logic (server.ts:325-362) |
| 13 | Delete/trash: tombstone RMW + trash-view filter; bucket compaction/purge | M | bridge server `/files/trash` handler | server.ts:603-666 semantics, client keeps its UX |
| 14 | Silent-drop semantics: treat empty-404 ≠ JSON-404 (§5); never auto-logout on empty 404; gate `/users/session-validity` behind protocol-aware session check | S | http.ts error handling; authenticated-session.ts | — |
| 15 | Ack wiring (optional for fork): `POST /photo/ack` for tests/CLI parity; `GET /status` photo_pending in UI | S | settings/debug panel | — |
| 16 | E2E test harness: reuse `/home/z/my-project/scripts/e2e/` against a local protocol-server mock (DO + R2 stubs) | M | test scripts | existing harness |

---

## 8. Risks & open questions

1. **Originals after ack (biggest semantic gap).** In protocol-land the server DELETES orig chunks on ack (§17) — only `p/{uid}.pv` is permanent; the SD card is the original's home (§19 restore "restores state, not bytes"). The ente model treats the server as the source of truth for originals. If the fork both uploads and later reads originals, it must keep its local-vault copy forever and treat protocol blobs as a transport to the clock — i.e. the fork would only ack what it has durably stored locally. Needs a product decision.
2. **Thumbnails vs previews, re-sealed.** ente thumbnails (secretstream, display cache, regenerable) ≠ protocol pv (secretbox, PERMANENT, ≤256KiB, the clock's only in-server image). Mapping is clean (fork thumbnail → pv) but the permanence + 256KiB cap must be enforced at seal time; current budget (≤100KiB) is fine.
3. **Multiple collections vs single stream.** photo_index is one global monthly-bucketed stream with no album concept. Either (a) flatten: album membership lives in local rows only, invisible to the clock; or (b) propose additive row types (§22 allows in minor bumps). Open question for the protocol owner.
4. **ML data has no protocol home.** ML index (faces/CLIP embeddings) lives in the local wasm ml_db (`ml/index.ts` worker, rust ml_store); only `cgroup`/`location` user-entities (people assignments, location tags — user-entity/index.ts:29) and the `faceSearchEnabled` remote-store flag (ml/index.ts:148) sync. In protocol-land these stay device-local or need new row types. Not blocking for the clock use-case (clock ignores ML).
5. **Range/streaming.** Protocol blob GETs have no Range; the viewer's video streaming (`native-stream`, HLS videoData) would need chunk-reassembly or progressive fetch. Photos (display via pv) unaffected.
6. **Silent-drop 404s vs session logic.** Any unauthenticated/unknown route returns an EMPTY 404 (§4). The client's `ensureOk` + token expiry paths could misread a silent drop as "session invalid" and loop. Item 14 of the checklist.
7. **taken_ts u32 domain.** EXIF dates before 1970 or after 2106 don't fit u32; spec says 0 if unknown — fine, but pre-1970 photos silently become "undated". Edge case, document it.
8. **Fork's `updationTime` micros vs protocol `ver`.** All diff logic in the client (sinceTime pagination, hasMore) assumes micros timestamps; strategy A bridge must synthesize monotonic times from bucket vers. Mechanical but touches every diff consumer.
9. **`/users/details/v2` and dead accounts endpoints** (srp, passkey, sessions — 25 apiURL calls in accounts/*) are unused in local mode but still compiled in; a protocol build should stub them to avoid surprises.
10. **`PREVIEW_PT_MAX` vs video previews.** §15.2 previews are images by construction ("source preview is a client-side downscale"); video thumbnails (ffmpeg frame extract, thumbnail.ts:105-115) seal fine as pv, but the clock only ever renders images — confirm video pv is even wanted, or restrict pv to images and let the clock skip videos via `bytes`/type heuristics (entry has no MIME field — open question).

---

*End of PROTOCOL-INTEGRATION.md — Agent C, Task 5, protocol scaffold audit.*
