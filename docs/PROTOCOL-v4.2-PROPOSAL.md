# PROTOCOL v4.2 PROPOSAL — the protocol moves to fit the Photos end case

Status: **proposal for the protocol owner.** Base: `protocol-v4.1.txt` (2026-10-19).
Working rule (owner, 2026-10-21): the fork is the fixed point; the protocol moves.
Companion map: `docs/PROTOCOL-INTEGRATION.md` (verified @ `4decf4e107`).
Evidence index in §6 cites the whole-repo audit batch 13 (reports under
`/home/z/my-project/audits/13-*.md`, preserved at the same commit).

---

## 0. The end case, in one paragraph

The end case is the Photos fork (this repo): a debranded, offline-first photo
gallery with on-device ML, shipped as web / Electron desktop / Flutter mobile.
Its backend today is a loopback "museum" server (a local, end-to-end-encrypted
vault on the user's own disk). The protocol's job is to become the wire the
vault speaks to the rest of the clock ecosystem (ESP32-S3 clock, phone, CLI)
without rewriting the fork: the fork keeps its museum API and its crypto
exactly as shipped; a small key-bearing bridge on the user's machine
translates at the boundary; the remote server stays an untrusted relay.
Everything below is judged by one question: *what must change so the bridge
stays small and the fork changes zero?*

## 1. Errata to v4.1 (no wire change; fold into any printing)

1. **§0 changelog** says K_photo is "wrapped under **K_data**"; §15.1 says
   (correctly, and is authoritative) **K_wrap**. Fix §0.
2. **§15.3 zero-byte originals**: N = ceil(size/1MiB) is ambiguous at
   size=0. Define: a 0-byte original uploads **only the hdr object** (§2.2),
   zero chunks; entry `bytes = 0`.
3. **§5 asymmetry note**: authenticated-404 carries `{"error":"not_found"}`,
   unauthenticated-404 is empty — already specified; restate that bridging
   components MUST NOT collapse the two classes (a silent drop is never a
   session event; see §23.3 law 9).

## 2. Wire changes (additive; minor bump 4.1 -> 4.2 per §22)

### 2.1 CHUNK_PT_MAX: 1 MiB -> 4 MiB (§2, §15.3, §21)

The fork seals originals in **4 MiB secretstream frames** on all three
platforms (web `types.ts:6`, rust `stream.rs:20`, mobile `crypto.dart:15` —
audit-verified identical). Adopting 4 MiB lets the bridge relay original
bytes **verbatim**: no re-chunk, no re-encrypt, no second crypto domain on
the hot path. Side effects are all favorable: ~4× fewer R2 objects and PUTs
per photo; the clock's pull is incremental (secretstream pulls decrypt
streamingly — RAM is bounded by the read buffer, not the frame size).

Changes: `CHUNK_PT_MAX = 4194304` (§2); §15.3 "1MiB" -> "4MiB" (three
places); §21 caps table `chunk body <= 4MiB + 17`. Chunk index stays 4
digits (4 MiB × 9999 ≈ 40 GB per original — ample; §2 CHUNK_DIGITS
unchanged). PREVIEW_PT_MAX unchanged (fork thumbnails are <=100 KiB at
720 px — 2.6× headroom under the 256 KiB cap).

### 2.2 The 24B stream header becomes a first-class object

New route pair (§17):

```
PUT  /blob/orig/{uid}/hdr      Auth: AUTH_UI.  Body: the 24B
                               secretstream header (SECRETSTREAM_HDR;
                               exact length 24B, else 400).
                               Server: stores R2  p/{uid}/hdr.
GET  /blob/orig/{uid}/hdr      Auth: either.    200 -> 24B body;
                               missing -> 404 {"error":"not_found"}.
```

R2 class: **staging** (`p/{uid}/*` — ack step 1 already deletes all of
`p/{uid}/*`, and the §19 sweep already covers it; **no ack or cron change
needed**).

Rationale: the fork stores the header as a separate field everywhere
(`decryptionHeader`, next to the object key — every sealed blob row on all
three platforms). With this route the bridge forwards the fork's header
field as one 24B object and relays each 4 MiB frame as `/blob/orig/{uid}/{n}`
unchanged. The alternative — v4.1's "header inlined into chunk 0" — forces
the bridge to re-chunk every original; that is the single most expensive
component of a v4.1-era bridge and it disappears here.

Ordering (§16 law unchanged, restated): staging order is irrelevant — the
bucket RMW is the commit record. §18 step 4 gains one line: fetch the hdr
object before decrypting chunk 0.

### 2.3 photo_index entry: `flags` bit1 = is_video (§16)

The entry carries no MIME field; the fork's thumbnails seal a video frame
extract just fine as pv, but the clock renders images only. Define
`flags bit1 = video` so the clock can skip originals for video entries while
still showing the pv. Bits 2-7 stay reserved. `bytes`/`taken_ts` semantics
unchanged.

### 2.4 sha16 becomes OPTIONAL (§15.4)

`sha16 = 8 zero bytes` means "not computed"; the clock then relies on the
per-frame AEAD tags (which already authenticate every byte of the stream,
and the FINAL tag seals it). Rationale: the fork's uploader computes MD5 over
ciphertext and BLAKE2b over metadata — no sha256 over plaintext exists on
any platform, and a bridge (which never sees plaintext) cannot add one. A
mandatory sha16 would force a fork change; the AEAD already provides the
integrity the sha16 duplicates. Era-A CLI may keep computing it.

### 2.5 Caps table (§21) diff summary

```
chunk body                 <= 4MiB + 17          (was 1MiB + 17)
chunk 0                    ct only               (unchanged; header now lives
                                                 in /blob/orig/{uid}/hdr)
hdr object body            exactly 24B           (new)
preview body               <= 24 + 256KiB + 16   (unchanged)
sha16                      optional (0 = absent) (was mandatory)
```

## 3. New §23 — Integration profiles

v4.1 speaks of "era A (CLI)" and "era B (ente fork)" without saying what era
B actually is. This section defines both so the trust model stays explicit.

### 23.1 Topology and trust model

```
era A (unchanged):
  CLI/phone/clock  <-->  Worker+DO+R2  (relay)

era B (the fork; this proposal):
  Photos fork  <-->  key-bearing local bridge  <-->  Worker+DO+R2
  (museum API,      (loopback, user machine,        (unchanged v4.1 server:
   loopback or        holds protocol keys,           untrusted relay — T1/T2
   on-device)         museum<->protocol              still hold)
                       translation)
```

The bridge is a **user-machine component inside the user's trust boundary**
— the same status the fork's renderer (which holds the vault keys in
OS-safeStorage) already has. The server's trust model is untouched: it still
holds no content keys, sees only opaque bytes, and cannot forge anything any
client accepts. The fork's own backend already runs on the user's machine
(the loopback vault); era B gives that process a second job — projecting the
vault onto the protocol — and changes nothing about who trusts whom.

### 23.2 Key setup: AES1 MAY be the fork's existing master key

The fork's local vault already provisions a random 32B master key at first
run (`local-vault.ts`, OS safeStorage / localforage at rest). Era B: **the
bridge uses that master key AS AES1** — it derives K_data / K_wrap / K_c2u /
AUTH_UI via the standard HKDF info strings (§3) and registers the wrap in
the config row via `PUT /bootstrap` exactly as the era-A CLI would. The fork
never sees a PASSWORD; the clock ecosystem's PASSWORD protects the wrap on
the server side, exactly as in era A. One key material, zero fork changes.

### 23.3 Bridge responsibilities (the bridge laws)

The museum API the bridge must implement is enumerated in
`PROTOCOL-INTEGRATION.md` §4 (56 routes; 46 strictly live). The laws that
make or break the fork's diff engine (all verified against the shipped
fork, audit 13-c M3 / 13-b M4):

1. **updationTime is load-bearing.** Every museum route that adds, copies,
   trashes, restores, or edits a file row (incl. magic-metadata) must bump
   the owning collection's `updationTime` — the client skips a collection
   diff when `savedLastSyncTime == collection.updationTime`. (This is the
   class of bug that silently killed ML sync in the fork's own backend;
   fixed there in this batch, now codified.)
2. **Synthesize strictly-monotonic epoch-micros** for every `sinceTime` diff
   route from bucket `ver` counters; never emit a timestamp <= one the
   client already persisted (all fork diff filters are strict `>`; a
   regressed clock would freeze every diff forever).
3. **Tombstone-first deletes**; trash rows carry `isDeleted`/`isRestored`
   and the client drops `isRestored` rows from the trash view.
4. **`/trash/empty` honors `lastUpdatedAt`** (protects items trashed after
   the caller's last pull) and never purges restored rows.
5. **`/remote-store/feature-flags` must answer** — the fork's 5-minute sync
   runs it on every pull and throws on non-JSON.
6. **IDs are bridge-allocated**: museum numeric file/collection IDs map to
   protocol uids (12B random) in a bridge-private table; `POST /files`
   returns the row with server-assigned id + updationTime (the fork's zod
   schemas require `z.number()` ids).
7. **Ack only after durable local commit** (answers v4.1 open question 1):
   the fork's local vault is the original's home; the bridge acks a uid
   only once the row + blobs are durably in that vault. The protocol's
   ack-then-delete staging then behaves exactly as designed — the remote
   server is a transport, not the original's home.
8. **Preview re-seal is cheap and bridge-side**: fork thumbnails
   (secretstream) are re-sealed as §15.2 secretbox pv at translation time;
   thumbnails are regenerable display caches, never the original.
9. **Silent-drop insulation**: an empty protocol 404 (silent drop, §4) is
   never surfaced to the fork as a session event — `/users/session-validity`
   always answers 200, or the fork's session layer can loop into logout.
10. **Paginate honestly or return full sets with `hasMore:false`** — the
    fork's diff loops tolerate both, but a response that repeats
    already-seen rows loops forever.
11. **Presigned-write auth stays loopback-only** — the fork's HMAC blob-write
    URLs never leave the machine; the bridge re-issues protocol bearer
    requests on the wire.

### 23.4 Optional additive row types (fork-side state that wants syncing)

All under K_data, all <= ROW_CT_MAX, all minor-bump-legal (§22). None are
required for the clock; they exist so a second fork device (or a re-install)
sees the same people/albums/settings. The ML embeddings themselves stay
device-local (size; §16 budget) — by design.

| Row id | Payload (JSON, AES-GCM under K_data) | Notes |
|---|---|---|
| `ent:{type}:{uuid}` | user-entity: encrypted per-type key wrap + payload digest, mirroring the fork's `/user-entity` shapes (types `location`, `cgroup`) | people assignments, location tags |
| `alb:{uuid}` | album row: name, type, member uids (<=512/row) | album membership for multi-device sync; the fork's albums otherwise live only in the vault that created them |
| `rst:settings` | remote-store map (`mapEnabled`, `faceSearchEnabled`) | the fork's `/remote-store` settings |

### 23.5 What deliberately does NOT change

Previews stay secretbox (§15.2) — the bridge re-seals; K_photo wrap stays
AES-GCM under K_wrap (§15.1) — the bridge re-wraps (32 B/photo, it holds the
master key); rows/WS/auth stay AES-GCM (§6/§11); the silent drop stays (§4);
ack-then-delete stays (§17); rotation stays (§20 — and stays cheap: rotation
re-wraps the 48 B entry fields, never re-encrypts blobs); the fork keeps
Argon2id internally wherever its own code expects it (§15.5 already permits
this).

## 4. Compatibility

* `/version` returns `"4.2"`.
* `CHUNK_PT_MAX` is a **server-side acceptance cap**: a 4.2 server accepts
  frames up to 4 MiB and rejects larger with 400. A 4.1 server rejects a
  4 MiB frame with 400 — so an era-B bridge MUST check `/version` and refuse
  to upload to a 4.1 server (fail closed, surface in the fork's ML/error UI
  path) rather than half-fail per frame.
* The hdr route is additive: 4.1 clients never call it; 4.2 servers must
  treat a missing hdr on GET as 404 exactly like a missing chunk.
* Optional row types (§23.4) are ignorable by any client (§5
  unspecified-fields rule) — including the clock.

## 5. §22 one-paragraph rule check

"Bigger frames, one more opaque 24B object, three ignorable row types, an
optional digest, and a named integration profile — more opaque bytes, same
trust model." **Passes.** Nothing above changes what the server can see or
forge; the server remains a relay that stores and forwards.

## 6. Evidence index (audit batch 13, all @ the companion commit)

| Claim in this proposal | Evidence |
|---|---|
| 4 MiB frames, 3 platforms, identical | 13-g M3 (types.ts:6 ↔ stream.rs:20 ↔ crypto.dart:15); PROTOCOL-INTEGRATION §2 row b |
| header stored separately everywhere (`decryptionHeader`) | PROTOCOL-INTEGRATION §2 rows a/b; 13-b M2 |
| thumbnails <=100 KiB @720 px, secretstream | 13-b M2 (thumbnail.ts:14-15); PROTOCOL-INTEGRATION §2 row a |
| no sha256-over-plaintext on any platform (MD5-ct, BLAKE2b-metadata only) | 13-b M2 (settings.ts:114) |
| master key = random 32B, safeStorage at rest (AES1 candidate) | PROTOCOL-INTEGRATION §6; 13-a M1 row f |
| museum surface = 56 routes (46 live) | 13-b M4.1 |
| bridge laws 1-11 | 13-c M3 (28 laws, condensed); 13-b M3/M4 |
| updationTime bump sites incl. the ML-enabling fix | 13-c M3 (server.ts:722-723); this batch's commit (4120573902) |
| ack-after-durable-commit is the fork's only safe mode | 13-c M3/M4; PROTOCOL-INTEGRATION §8 risk 1 |
| EXIF taken_ts available (epoch micros) | 13-b M2 (exif.ts:39-41) |
| silent-drop vs session-validity hazard | 13-b M4; PROTOCOL-INTEGRATION §8 item 14 |
| §0 K_data/K_wrap erratum | 13-a M3 (flagged to the protocol owner) |

---

*End of PROTOCOL-v4.2-PROPOSAL.md — batch 13, whole-repo audit + protocol
alignment (the protocol moves to fit the end case).*
