import type { IncomingMessage, ServerResponse } from "node:http";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import { URL } from "node:url";
import { LocalVaultStore, type StoredFile } from "./store";

/**
 * A loopback-only HTTP server that implements the subset of the museum API
 * used by the Photos web/desktop clients, backed by local disk.
 *
 * The renderer talks to this server as its "API origin", which makes every
 * existing client flow (albums, uploads, trash, ML data, feature flags)
 * work unchanged in a fully offline, standalone deployment.
 *
 * All payloads are opaque: the client encrypts everything end-to-end.
 */

export interface LocalBackendOptions {
    /** Directory for state.json and blobs/. */
    dataDir: string;
    /** Preferred port; subsequent ports are tried if busy. */
    port: number;
    /** How many ports to try starting at `port` (inclusive). */
    portTries?: number;
    log?: (...args: unknown[]) => void;
}

export interface LocalBackend {
    port: number;
    origin: string;
    close: () => Promise<void>;
    /**
     * Register the vault token; once set, all API routes (but not the
     * presigned blob transport or the uploader bridge) require it as the
     * `X-Auth-Token` header.
     */
    setExpectedToken: (token: string) => void;
    /** Forget the vault token (logout); reopens the API + stops signing. */
    clearExpectedToken: () => void;
    /** Persist the store state without stopping the server. */
    flush: () => void;
}

const localUser = { id: 1, email: "local@vault", role: "owner" };

const trashRetentionMicros = 30 * 24 * 60 * 60 * 1000 * 1000; // 30 days

/** A single 206 response serves at most this many bytes (a server may
 * return a subset of the requested range); caps range-buffer allocations. */
const MAX_RANGE_BYTES = 32 * 1024 * 1024;

const startLocalBackend = (opts: LocalBackendOptions): Promise<LocalBackend> =>
    new Promise((resolve, reject) => {
        const log = opts.log ?? console.log;
        const store = new LocalVaultStore(opts.dataDir);
        // Garbage-collect soft-deleted rows and unreferenced blobs left over
        // from previous sessions (permanent deletes, 60d-old tombstones).
        try {
            store.sweepExpiredTombstones();
        } catch (e) {
            log("[local-backend] tombstone sweep failed", e);
        }
        const tries = opts.portTries ?? 10;
        // The renderer registers the vault token over IPC once the vault is
        // ready; until then (and in the standalone dev server) the server
        // runs open, so the boot-time origin discovery cannot 401.
        const authState: AuthState = {
            expectedToken: undefined,
            presignSecret: undefined,
        };

        const attempt = (offset: number) => {
            if (offset >= tries) {
                reject(
                    new Error(
                        `[local-backend] no free port in ${opts.port}..${opts.port + tries - 1}`,
                    ),
                );
                return;
            }
            const port = opts.port + offset;
            const server = http.createServer((req, res) => {
                handle(store, req, res, port, log, authState).catch((e) => {
                    log("[local-backend] unhandled error", e);
                    if (!res.headersSent) {
                        res.writeHead(500, corsHeaders());
                        res.end(JSON.stringify({ error: "internal" }));
                    } else {
                        res.destroy();
                    }
                });
            });

            server.on("error", (e: NodeJS.ErrnoException) => {
                if (e.code === "EADDRINUSE") {
                    attempt(offset + 1);
                } else {
                    reject(e);
                }
            });

            server.listen(port, "127.0.0.1", () => {
                log(`[local-backend] listening on http://127.0.0.1:${port}`);
                const close = () =>
                    new Promise<void>((resolveClose) => {
                        store.flush();
                        server.close(() => resolveClose());
                    });
                resolve({
                    port,
                    origin: `http://127.0.0.1:${port}`,
                    close,
                    setExpectedToken: (token: string) => {
                        authState.expectedToken = token;
                        // Blob write URLs are HMAC-signed with a secret
                        // derived from the token, so unauthenticated local
                        // processes cannot PUT/overwrite blobs at will.
                        authState.presignSecret = derivePresignSecret(token);
                    },
                    clearExpectedToken: () => {
                        authState.expectedToken = undefined;
                        authState.presignSecret = undefined;
                    },
                    flush: () => store.flush(),
                });
            });
        };

        attempt(0);
    });

export default startLocalBackend;

// --------------------------------------------------------------------- utils

interface AuthState {
    expectedToken: string | undefined;
    /** HMAC secret for signing blob write URLs (set with the token). */
    presignSecret: Buffer | undefined;
}

const presignTTLSeconds = 24 * 60 * 60; // 24h; generous for multipart sets

const derivePresignSecret = (token: string) =>
    crypto.createHash("sha256").update(`photos-presign:${token}`).digest();

/**
 * Mint a blob write URL. When a vault token is registered the URL carries
 * an expiry + HMAC signature that the blob write routes verify; without a
 * token (boot window / standalone dev server) URLs stay unsigned, matching
 * the open-server behaviour of that phase.
 */
const signedBlobWriteURL = (
    origin: string,
    key: string,
    secret: Buffer | undefined,
    part?: number,
) => {
    const base = `${origin}/blobs/${key}`;
    const partQuery = part ? `part=${part}` : "";
    if (!secret) return partQuery ? `${base}?${partQuery}` : base;
    const expires = Math.floor(Date.now() / 1000) + presignTTLSeconds;
    const mac = crypto
        .createHmac("sha256", secret)
        .update(`${base}?part=${part ?? 0}:${expires}`)
        .digest("hex");
    const sep = partQuery ? `${partQuery}&` : "";
    return `${base}?${sep}X-Expires=${expires}&X-Signature=${mac}`;
};

/** Verify the signature+expiry of a blob write URL (see signedBlobWriteURL). */
const verifyPresignedWrite = (
    urlString: string,
    secret: Buffer | undefined,
): boolean => {
    if (!secret) return true; // No token registered: open-server phase.
    let u: URL;
    try {
        u = new URL(urlString);
    } catch {
        return false;
    }
    const expires = Number(u.searchParams.get("X-Expires"));
    const signature = u.searchParams.get("X-Signature");
    if (!Number.isFinite(expires) || !signature) return false;
    if (Date.now() / 1000 > expires) return false;
    const part = Number(u.searchParams.get("part") ?? 0) || 0;
    const mac = crypto
        .createHmac("sha256", secret)
        .update(`${u.origin}${u.pathname}?part=${part}:${expires}`)
        .digest("hex");
    if (mac.length != signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(signature));
};

const corsHeaders = (): Record<string, string> => ({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Length, Content-Range",
    "Access-Control-Max-Age": "86400",
});

const sendJSON = (
    res: ServerResponse,
    status: number,
    body: unknown,
    extraHeaders: Record<string, string> = {},
) => {
    const headers = {
        ...corsHeaders(),
        "Content-Type": "application/json",
        ...extraHeaders,
    };
    if (body === undefined) {
        res.writeHead(status, headers);
        res.end();
        return;
    }
    const data = JSON.stringify(body);
    res.writeHead(status, { ...headers, "Content-Length": Buffer.byteLength(data) });
    res.end(data);
};

const sendEmpty = (res: ServerResponse, status = 200) => {
    res.writeHead(status, corsHeaders());
    res.end();
};

const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on("data", (chunk: Buffer) => {
            size += chunk.length;
            // Guard against runaway bodies (multipart parts stream separately).
            if (size > 512 * 1024 * 1024) {
                reject(new Error("body too large"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });

const readJSON = async (req: IncomingMessage): Promise<any> => {
    const body = await readBody(req);
    if (!body.length) return {};
    try {
        return JSON.parse(body.toString("utf8"));
    } catch {
        return {};
    }
};

const numericParam = (url: URL, name: string): number | undefined => {
    const raw = url.searchParams.get(name);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
};

const fileByID = (store: LocalVaultStore, id: number) =>
    store.files.find((f) => f.id === id && !f.isDeleted);

const collectionByID = (store: LocalVaultStore, id: number) =>
    store.collections.find((c) => c.id === id && !c.isDeleted);

/** A diff-safe file row: strip internal-only markers, keep client fields. */
const fileDiffEntry = (f: StoredFile, isDeleted: boolean) => ({
    ...f,
    isDeleted,
});

// ------------------------------------------------------------------- router

const handle = async (
    store: LocalVaultStore,
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
    log: (...args: unknown[]) => void,
    authState: AuthState,
) => {
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    const origin = `http://127.0.0.1:${port}`;

    if (method === "OPTIONS") {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
    }

    // Authenticated museum routes. Presigned blob transport and the native
    // uploader bridge are exempt (the client uploads to them exactly the way
    // it would upload to presigned object URLs, without an auth token), but
    // every API route requires the vault token once it has been registered.
    const isPresignedTransport =
        pathname.startsWith("/blobs/") ||
        pathname === "/file-upload" ||
        pathname === "/multipart-upload" ||
        pathname === "/multipart-complete";
    if (authState.expectedToken !== undefined && !isPresignedTransport) {
        if (req.headers["x-auth-token"] !== authState.expectedToken) {
            sendJSON(res, 401, { error: "unauthorized" });
            return;
        }
    }

    log(
        `[local-backend] ${method} ${pathname}${url.search.replace(
            /([?&])x-signature=[^&]*/i,
            "$1x-signature=<redacted>",
        )}`,
    );

    // ------------------------------------------------------- blob transport

    if (method === "PUT" && pathname === "/file-upload") {
        // Renderer uploader-worker proxy (single object).
        const uploadURL = req.headers["upload-url"];
        if (typeof uploadURL !== "string") {
            sendJSON(res, 400, { error: "missing UPLOAD-URL" });
            return;
        }
        if (!verifyPresignedWrite(uploadURL, authState.presignSecret)) {
            sendJSON(res, 403, { error: "forbidden" });
            return;
        }
        const body = await readBody(req);
        const key = objectKeyFromURL(uploadURL);
        store.writeBlob(key, body);
        store.markDirty();
        sendJSON(res, 200, {}, { ETag: etagFor(body) });
        return;
    }

    if (method === "PUT" && pathname === "/multipart-upload") {
        const uploadURL = req.headers["upload-url"];
        if (typeof uploadURL !== "string") {
            sendJSON(res, 400, { error: "missing UPLOAD-URL" });
            return;
        }
        if (!verifyPresignedWrite(uploadURL, authState.presignSecret)) {
            sendJSON(res, 403, { error: "forbidden" });
            return;
        }
        const body = await readBody(req);
        const { key, part } = parsePartURL(uploadURL);
        if (part) {
            store.writeBlobPart(key, part, body);
            store.markDirty();
            sendJSON(res, 200, { etag: etagFor(body) });
        } else {
            store.writeBlob(key, body);
            store.markDirty();
            sendJSON(res, 200, {}, { ETag: etagFor(body) });
        }
        return;
    }

    if (method === "POST" && pathname === "/multipart-complete") {
        const uploadURL = req.headers["upload-url"];
        if (typeof uploadURL !== "string") {
            sendJSON(res, 400, { error: "missing UPLOAD-URL" });
            return;
        }
        if (!verifyPresignedWrite(uploadURL, authState.presignSecret)) {
            sendJSON(res, 403, { error: "forbidden" });
            return;
        }
        const body = await readBody(req);
        completeFromXML(store, uploadURL, body);
        sendJSON(res, 200, {});
        return;
    }

    if (method === "PUT" && pathname.startsWith("/blobs/")) {
        if (
            !verifyPresignedWrite(
                url.toString(),
                authState.presignSecret,
            )
        ) {
            sendJSON(res, 403, { error: "forbidden" });
            return;
        }
        const key = decodeURIComponent(pathname.slice("/blobs/".length));
        // Keys are 32-hex object keys; anything else (incl. `..`) is a 404,
        // never a filesystem write.
        if (!/^[0-9a-f]{32}$/.test(key)) {
            sendJSON(res, 404, { error: "blob not found" });
            return;
        }
        const part = numericParam(url, "part");
        const body = await readBody(req);
        if (part) {
            store.writeBlobPart(key, part, body);
            store.markDirty();
            sendJSON(res, 200, {}, { ETag: etagFor(body) });
        } else {
            store.writeBlob(key, body);
            store.markDirty();
            sendJSON(res, 200, {}, { ETag: etagFor(body) });
        }
        return;
    }

    if (method === "POST" && pathname.startsWith("/blobs/")) {
        // Multipart completion, direct (non-proxied) path.
        if (
            !verifyPresignedWrite(
                url.toString(),
                authState.presignSecret,
            )
        ) {
            sendJSON(res, 403, { error: "forbidden" });
            return;
        }
        const key = decodeURIComponent(pathname.slice("/blobs/".length));
        if (!/^[0-9a-f]{32}$/.test(key)) {
            sendJSON(res, 404, { error: "blob not found" });
            return;
        }
        const body = await readBody(req);
        completeFromXML(store, `${origin}/blobs/${key}`, body);
        sendJSON(res, 200, {});
        return;
    }

    if (method === "GET" && pathname.startsWith("/blobs/")) {
        const key = decodeURIComponent(pathname.slice("/blobs/".length));
        // Keys are 32-hex object keys; anything else (incl. `..`) is a 404,
        // never a filesystem lookup.
        if (!/^[0-9a-f]{32}$/.test(key)) {
            sendJSON(res, 404, { error: "blob not found" });
            return;
        }
        serveBlob(store, req, res, key);
        return;
    }

    // ----------------------------------------------------------- collections

    if (method === "POST" && pathname === "/collections") {
        const body = await readJSON(req);
        const collection = {
            id: store.allocateCollectionID(),
            owner: localUser,
            encryptedKey: String(body.encryptedKey ?? ""),
            keyDecryptionNonce: body.keyDecryptionNonce ?? null,
            encryptedName: body.encryptedName ?? null,
            nameDecryptionNonce: body.nameDecryptionNonce ?? null,
            name: body.name ?? null,
            type: String(body.type ?? "album"),
            sharees: [],
            publicURLs: [],
            updationTime: store.nowMicros(),
            ...(body.magicMetadata ? { magicMetadata: body.magicMetadata } : {}),
            ...(body.pubMagicMetadata
                ? { pubMagicMetadata: body.pubMagicMetadata }
                : {}),
        };
        store.collections.push(collection);
        store.markDirty();
        sendJSON(res, 200, { collection });
        return;
    }

    if (method === "GET" && pathname === "/collections/v2") {
        const sinceTime = numericParam(url, "sinceTime") ?? 0;
        sendJSON(res, 200, {
            collections: store.collections.filter(
                (c) => c.updationTime > sinceTime,
            ),
        });
        return;
    }

    {
        const match = pathname.match(/^\/collections\/(\d+)$/);
        if (method === "GET" && match) {
            const collection = collectionByID(store, Number(match[1]));
            if (!collection) {
                sendJSON(res, 404, { error: "collection not found" });
                return;
            }
            sendJSON(res, 200, { collection });
            return;
        }
    }

    if (method === "GET" && pathname === "/collections/v2/diff") {
        const collectionID = numericParam(url, "collectionID") ?? 0;
        const sinceTime = numericParam(url, "sinceTime") ?? 0;
        const diff = store.files
            .filter(
                (f) =>
                    f.collectionID === collectionID && f.updationTime > sinceTime,
            )
            .map((f) => fileDiffEntry(f, f.isDeleted === true));
        // Tombstones for files removed from this collection after sinceTime.
        for (const t of store.tombstonesFor(collectionID)) {
            if (t.updationTime > sinceTime) {
                const known = store.files.find((f) => f.id === t.fileID);
                diff.push({
                    ...(known ?? {
                        id: t.fileID,
                        collectionID,
                        ownerID: localUser.id,
                        encryptedKey: "",
                        keyDecryptionNonce: "",
                        file: { objectKey: "", decryptionHeader: "", size: 0 },
                        thumbnail: {
                            objectKey: "",
                            decryptionHeader: "",
                            size: 0,
                        },
                        metadata: {},
                    }),
                    id: t.fileID,
                    collectionID,
                    isDeleted: true,
                    updationTime: t.updationTime,
                });
            }
        }
        sendJSON(res, 200, { diff, hasMore: false });
        return;
    }

    if (method === "POST" && pathname === "/collections/rename") {
        const body = await readJSON(req);
        const collection = collectionByID(store, Number(body.collectionID));
        if (!collection) {
            sendJSON(res, 404, { error: "collection not found" });
            return;
        }
        collection.encryptedName = String(body.encryptedName ?? "");
        collection.nameDecryptionNonce = body.nameDecryptionNonce ?? null;
        collection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (
        (method === "PUT" || method === "POST") &&
        (pathname === "/collections/magic-metadata" ||
            pathname === "/collections/public-magic-metadata" ||
            pathname === "/collections/sharee-magic-metadata")
    ) {
        const body = await readJSON(req);
        const collection = collectionByID(store, Number(body.id));
        if (!collection) {
            sendJSON(res, 404, { error: "collection not found" });
            return;
        }
        if (pathname.includes("public")) {
            collection.pubMagicMetadata = body.magicMetadata;
        } else if (pathname.includes("sharee")) {
            collection.sharedMagicMetadata = body.magicMetadata;
        } else {
            collection.magicMetadata = body.magicMetadata;
        }
        collection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/collections/add-files") {
        const body = await readJSON(req);
        const collectionID = Number(body.collectionID);
        if (!collectionByID(store, collectionID)) {
            sendJSON(res, 404, { error: "collection not found" });
            return;
        }
        const files: { id: number; encryptedKey: string; keyDecryptionNonce: string }[] =
            body.files ?? [];
        for (const item of files) {
            const source = fileByID(store, Number(item.id));
            if (!source) continue;
            // Adding to another album creates a new row referencing the same
            // object (client semantics: one row per collection membership).
            store.files.push({
                ...source,
                id: store.allocateFileID(),
                collectionID,
                encryptedKey: item.encryptedKey,
                keyDecryptionNonce: item.keyDecryptionNonce,
                updationTime: store.nowMicros(),
            });
        }
        const addCollection = collectionByID(store, collectionID);
        if (addCollection) addCollection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/collections/restore-files") {
        const body = await readJSON(req);
        const collectionID = Number(body.collectionID);
        const files: { id: number; encryptedKey: string; keyDecryptionNonce: string }[] =
            body.files ?? [];
        for (const item of files) {
            const file = store.files.find((f) => f.id === Number(item.id));
            if (!file) continue;
            file.collectionID = collectionID;
            file.encryptedKey = item.encryptedKey;
            file.keyDecryptionNonce = item.keyDecryptionNonce;
            file.isDeleted = false;
            file.updationTime = store.nowMicros();
            const trashItem = store.trash.find(
                (t) => t.file.id === file.id && !t.isDeleted && !t.isRestored,
            );
            if (trashItem) {
                trashItem.isRestored = true;
                trashItem.updatedAt = store.nowMicros();
            }
        }
        const restoreCollection = collectionByID(store, collectionID);
        if (restoreCollection)
            restoreCollection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/collections/move-files") {
        const body = await readJSON(req);
        const fromCollectionID = Number(body.fromCollectionID);
        const toCollectionID = Number(body.toCollectionID);
        const files: { id: number; encryptedKey: string; keyDecryptionNonce: string }[] =
            body.files ?? [];
        for (const item of files) {
            const file = store.files.find(
                (f) => f.id === Number(item.id) && !f.isDeleted,
            );
            if (!file) continue;
            store.addTombstone(
                fromCollectionID,
                file.id,
                store.nowMicros(),
            );
            file.collectionID = toCollectionID;
            file.encryptedKey = item.encryptedKey;
            file.keyDecryptionNonce = item.keyDecryptionNonce;
            file.updationTime = store.nowMicros();
        }
        for (const cid of [fromCollectionID, toCollectionID]) {
            const c = collectionByID(store, cid);
            if (c) c.updationTime = store.nowMicros();
        }
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/collections/v3/remove-files") {
        const body = await readJSON(req);
        const collectionID = Number(body.collectionID);
        const fileIDs: number[] = (body.fileIDs ?? []).map(Number);
        for (const id of fileIDs) {
            const file = store.files.find((f) => f.id === id);
            if (!file) continue;
            store.addTombstone(collectionID, file.id, store.nowMicros());
            file.isDeleted = true;
            file.updationTime = store.nowMicros();
        }
        const removeCollection = collectionByID(store, collectionID);
        if (removeCollection) removeCollection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    {
        const match = pathname.match(/^\/collections\/v3\/(\d+)$/);
        if (method === "DELETE" && match) {
            const collection = store.collections.find(
                (c) => c.id === Number(match[1]),
            );
            if (!collection) {
                sendJSON(res, 404, { error: "collection not found" });
                return;
            }
            const updationTime = store.nowMicros();
            collection.isDeleted = true;
            collection.updationTime = updationTime;
            // Rows in this collection die with it; the client prunes them.
            // Permanent delete: rows + (refcounted) blobs are removed too.
            const fileIDs = store.files
                .filter((f) => f.collectionID === collection.id)
                .map((f) => f.id);
            for (const file of store.files) {
                if (file.collectionID === collection.id && !file.isDeleted) {
                    file.isDeleted = true;
                    file.updationTime = updationTime;
                }
            }
            store.purgeFiles(fileIDs);
            store.markDirty();
            sendJSON(res, 200, {});
            return;
        }
    }

    if (method === "GET" && pathname === "/collection-actions/pending-remove") {
        sendJSON(res, 200, { actions: [] });
        return;
    }

    // ----------------------------------------------------------------- files

    if (method === "POST" && pathname === "/files") {
        const body = await readJSON(req);
        if (!collectionByID(store, Number(body.collectionID))) {
            sendJSON(res, 404, { error: "collection not found" });
            return;
        }
        const file: StoredFile = {
            id: store.allocateFileID(),
            collectionID: Number(body.collectionID),
            ownerID: localUser.id,
            encryptedKey: String(body.encryptedKey ?? ""),
            keyDecryptionNonce: String(body.keyDecryptionNonce ?? ""),
            file: {
                objectKey: String(body.file?.objectKey ?? ""),
                decryptionHeader: String(body.file?.decryptionHeader ?? ""),
                size: Number(body.file?.size ?? 0),
            },
            thumbnail: {
                objectKey: String(body.thumbnail?.objectKey ?? ""),
                decryptionHeader: String(
                    body.thumbnail?.decryptionHeader ?? "",
                ),
                size: Number(body.thumbnail?.size ?? 0),
            },
            // The upstream museum server populates info; the client never
            // sends it. Synthesize it so Large files / Find duplicates and
            // the ML size guard work against the local backend.
            info: body.info ?? { fileSize: Number(body.file?.size ?? 0) },
            updationTime: store.nowMicros(),
            metadata: body.metadata ?? {},
            ...(body.pubMagicMetadata !== undefined
                ? { pubMagicMetadata: body.pubMagicMetadata }
                : {}),
        };
        store.files.push(file);
        // Museum semantics: adding files to a collection advances its
        // updationTime so that clients re-diff the collection.
        const collection = collectionByID(store, file.collectionID);
        if (collection) collection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, file);
        return;
    }

    if (method === "POST" && pathname === "/files/copy") {
        const body = await readJSON(req);
        const dstCollectionID = Number(body.dstCollectionID);
        if (!collectionByID(store, dstCollectionID)) {
            sendJSON(res, 404, { error: "collection not found" });
            return;
        }
        const files: { id: number; encryptedKey: string; keyDecryptionNonce: string }[] =
            body.files ?? [];
        const oldToNewFileIDMap: Record<string, number> = {};
        for (const item of files) {
            const source = fileByID(store, Number(item.id));
            if (!source) continue;
            const newID = store.allocateFileID();
            oldToNewFileIDMap[item.id.toString()] = newID;
            store.files.push({
                ...source,
                id: newID,
                collectionID: dstCollectionID,
                ownerID: localUser.id,
                encryptedKey: item.encryptedKey,
                keyDecryptionNonce: item.keyDecryptionNonce,
                updationTime: store.nowMicros(),
            });
        }
        // Museum semantics: copying into a collection must advance its
        // updationTime, or clients that already synced it never re-diff it.
        const dstCollection = collectionByID(store, dstCollectionID);
        if (dstCollection) dstCollection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, { oldToNewFileIDMap });
        return;
    }

    if (method === "POST" && pathname === "/files/trash") {
        const body = await readJSON(req);
        // The client sends {items:[{fileID,collectionID}]} (the upstream
        // museum shape); {fileIDs} is the older variant. Accept both.
        const fileIDs: number[] = body.items
            ? body.items.map((i: { fileID: unknown }) => Number(i.fileID))
            : (body.fileIDs ?? []).map(Number);
        const updatedAt = store.nowMicros();
        const deleteBy = updatedAt + trashRetentionMicros;
        const trashedCollectionIDs = new Set<number>();
        for (const id of fileIDs) {
            const file = store.files.find((f) => f.id === id && !f.isDeleted);
            if (!file) continue;
            store.addTombstone(file.collectionID, file.id, store.nowMicros());
            trashedCollectionIDs.add(file.collectionID);
            file.isDeleted = true;
            file.updationTime = store.nowMicros();
            // A fresh row per trash entry (re-trashing restores first).
            for (let i = store.trash.length - 1; i >= 0; i--) {
                if (store.trash[i]!.file.id === file.id) store.trash.splice(i, 1);
            }
            store.trash.push({
                file: { ...file },
                isDeleted: false,
                isRestored: false,
                updatedAt,
                deleteBy,
            });
        }
        for (const cid of trashedCollectionIDs) {
            const c = collectionByID(store, cid);
            if (c) c.updationTime = store.nowMicros();
        }
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/trash/delete") {
        const body = await readJSON(req);
        const fileIDs = new Set<number>((body.fileIDs ?? []).map(Number));
        // Never purge rows the user already restored out of the trash.
        await deleteTrashItems(
            store,
            (t) => fileIDs.has(t.file.id) && !t.isRestored,
        );
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/trash/empty") {
        // Honor the client's cutoff (protect items trashed after its last
        // pull) and never purge rows that were restored out of the trash.
        const body = await readJSON(req).catch(() => ({}));
        const cutoff = Number(body.lastUpdatedAt ?? 0) || 0;
        await deleteTrashItems(
            store,
            (t) =>
                !t.isDeleted &&
                !t.isRestored &&
                (cutoff === 0 || t.updatedAt <= cutoff),
        );
        sendJSON(res, 200, {});
        return;
    }

    if (method === "GET" && pathname === "/trash/v2/diff") {
        const sinceTime = numericParam(url, "sinceTime") ?? 0;
        sendJSON(res, 200, {
            diff: store.trash
                .filter((t) => t.updatedAt > sinceTime)
                .map((t) => ({
                    file: t.file,
                    isDeleted: t.isDeleted,
                    isRestored: t.isRestored,
                    updatedAt: t.updatedAt,
                    deleteBy: t.deleteBy,
                })),
            hasMore: false,
        });
        return;
    }

    {
        const match = pathname.match(/^\/files\/(download|thumbnail)\/v3\/(\d+)$/);
        if (method === "GET" && match) {
            const file = fileByID(store, Number(match[2]));
            if (!file) {
                sendJSON(res, 404, { error: "file not found" });
                return;
            }
            const objectKey =
                match[1] === "download" ? file.file.objectKey : file.thumbnail.objectKey;
            sendJSON(res, 200, { url: `${origin}/blobs/${objectKey}` });
            return;
        }
    }

    {
        // Legacy (pre-v3) direct-download endpoints.
        const match = pathname.match(/^\/files\/(download|preview)\/(\d+)$/);
        if (method === "GET" && match) {
            const file = fileByID(store, Number(match[2]));
            if (!file) {
                sendJSON(res, 404, { error: "file not found" });
                return;
            }
            const objectKey =
                match[1] === "download" ? file.file.objectKey : file.thumbnail.objectKey;
            serveBlob(store, req, res, objectKey);
            return;
        }
    }

    if (
        (method === "PUT" || method === "POST") &&
        (pathname === "/files/magic-metadata" ||
            pathname === "/files/public-magic-metadata")
    ) {
        const body = await readJSON(req);
        const metadataList: { id: number; magicMetadata: unknown }[] =
            body.metadataList ?? [];
        const touchedCollectionIDs = new Set<number>();
        for (const item of metadataList) {
            const file = store.files.find((f) => f.id === Number(item.id));
            if (!file) continue;
            if (pathname.includes("public")) {
                file.pubMagicMetadata = item.magicMetadata;
            } else {
                file.magicMetadata = item.magicMetadata;
            }
            file.updationTime = store.nowMicros();
            touchedCollectionIDs.add(file.collectionID);
        }
        // Museum semantics: file-row mutations must bump the owning
        // collection's updationTime, or synced clients skip the re-diff.
        for (const cid of touchedCollectionIDs) {
            const collection = collectionByID(store, cid);
            if (collection) collection.updationTime = store.nowMicros();
        }
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    // --------------------------------------------------------- file uploads

    if (method === "GET" && pathname === "/files/upload-urls") {
        const count = Math.min(50, Math.max(1, numericParam(url, "count") ?? 1));
        const urls = Array.from({ length: count }, () => {
            const objectKey = store.newObjectKey();
            return {
                objectKey,
                url: signedBlobWriteURL(
                    origin,
                    objectKey,
                    authState.presignSecret,
                ),
            };
        });
        sendJSON(res, 200, { urls });
        return;
    }

    if (method === "POST" && pathname === "/files/upload-url") {
        await readJSON(req);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectKey,
            url: signedBlobWriteURL(
                origin,
                objectKey,
                authState.presignSecret,
            ),
        });
        return;
    }

    if (method === "GET" && pathname === "/files/multipart-upload-urls") {
        const count = Math.min(10000, Math.max(1, numericParam(url, "count") ?? 1));
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            urls: {
                objectKey,
                partURLs: Array.from(
                    { length: count },
                    (_, i) =>
                        signedBlobWriteURL(
                            origin,
                            objectKey,
                            authState.presignSecret,
                            i + 1,
                        ),
                ),
                completeURL: signedBlobWriteURL(
                    origin,
                    objectKey,
                    authState.presignSecret,
                ),
            },
        });
        return;
    }

    if (method === "POST" && pathname === "/files/multipart-upload-url") {
        const body = await readJSON(req);
        const contentLength = Number(body.contentLength ?? 0);
        const partLength = Number(body.partLength ?? 0);
        const partMd5s: string[] = body.partMd5s ?? [];
        const count = partMd5s.length ||
            (partLength > 0 ? Math.ceil(contentLength / partLength) : 1);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectKey,
            partURLs: Array.from(
                { length: Math.max(1, count) },
                (_, i) =>
                    signedBlobWriteURL(
                        origin,
                        objectKey,
                        authState.presignSecret,
                        i + 1,
                    ),
            ),
            completeURL: signedBlobWriteURL(
                origin,
                objectKey,
                authState.presignSecret,
            ),
        });
        return;
    }

    // ------------------------------------------------------------ file data

    if (method === "PUT" && pathname === "/files/data") {
        const body = await readJSON(req);
        const key = `${Number(body.fileID)}:${String(body.type)}`;
        store.fileData[key] = {
            fileID: Number(body.fileID),
            type: String(body.type),
            encryptedData: String(body.encryptedData ?? ""),
            decryptionHeader: String(body.decryptionHeader ?? ""),
            updatedAt: store.nowMicros(),
        };
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/files/data/fetch") {
        const body = await readJSON(req);
        const type = String(body.type ?? "");
        const fileIDs = new Set<number>((body.fileIDs ?? []).map(Number));
        const data = Object.values(store.fileData).filter(
            (fd) => fd.type === type && fileIDs.has(fd.fileID),
        );
        sendJSON(res, 200, { data });
        return;
    }

    if (method === "GET" && pathname === "/files/data/fetch") {
        const fileID = numericParam(url, "fileID");
        const type = url.searchParams.get("type") ?? "";
        const entry = store.fileData[`${fileID}:${type}`];
        if (!entry) {
            sendEmpty(res, 204);
            return;
        }
        sendJSON(res, 200, { data: entry });
        return;
    }

    if (method === "POST" && pathname === "/files/data/status-diff") {
        const lastUpdatedAt = Number(
            (await readJSON(req)).lastUpdatedAt ?? 0,
        );
        const diff = Object.values(store.fileData)
            .filter((fd) => fd.updatedAt > lastUpdatedAt)
            .map((fd) => ({
                fileID: fd.fileID,
                type: fd.type,
                isDeleted: false,
                updatedAt: fd.updatedAt,
            }));
        sendJSON(res, 200, { diff });
        return;
    }

    if (method === "GET" && pathname === "/files/data/preview") {
        // The playlist was written to fileData when the segments were
        // uploaded (see PUT /files/video-data); the segments themselves are
        // served as a plain blob GET via this presigned-style URL.
        const fileID = numericParam(url, "fileID");
        const entry = fileID !== undefined ? store.videoData[fileID] : undefined;
        if (!entry || !entry.objectID) {
            sendJSON(res, 404, { error: "no preview data" });
            return;
        }
        sendJSON(res, 200, { url: `${origin}/blobs/${entry.objectID}` });
        return;
    }

    if (method === "GET" && pathname === "/files/data/preview-upload-url") {
        // Native HLS generation (ffmpeg-worker) requests upload URLs with a
        // GET (non-V2 flow); multipart when isMultiPart=true&count=N.
        const isMultiPart = url.searchParams.get("isMultiPart") == "true";
        const count = Math.min(
            10000,
            Math.max(1, numericParam(url, "count") ?? 1),
        );
        const objectKey = store.newObjectKey();
        if (isMultiPart) {
            sendJSON(res, 200, {
                objectID: objectKey,
                partURLs: Array.from(
                    { length: count },
                    (_, i) =>
                        signedBlobWriteURL(
                            origin,
                            objectKey,
                            authState.presignSecret,
                            i + 1,
                        ),
                ),
                completeURL: signedBlobWriteURL(
                    origin,
                    objectKey,
                    authState.presignSecret,
                ),
            });
        } else {
            sendJSON(res, 200, {
                objectID: objectKey,
                url: signedBlobWriteURL(
                    origin,
                    objectKey,
                    authState.presignSecret,
                ),
            });
        }
        return;
    }

    if (method === "POST" && pathname === "/multipart-preview-upload-url") {
        // V2 flow: the body carries part checksums; the count comes from them
        // (or from contentLength / partLength when absent).
        const body = await readJSON(req);
        const contentLength = Number(body.contentLength ?? 0);
        const partLength = Number(body.partLength ?? 0);
        const partMd5s: string[] = body.partMd5s ?? [];
        const count = partMd5s.length ||
            (partLength > 0 ? Math.ceil(contentLength / partLength) : 1);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectID: objectKey,
            partURLs: Array.from(
                { length: Math.max(1, count) },
                (_, i) =>
                    signedBlobWriteURL(
                        origin,
                        objectKey,
                        authState.presignSecret,
                        i + 1,
                    ),
            ),
            completeURL: signedBlobWriteURL(
                origin,
                objectKey,
                authState.presignSecret,
            ),
        });
        return;
    }

    if (method === "POST" && pathname === "/files/data/preview-upload-url") {
        await readJSON(req);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectKey,
            objectID: objectKey,
            url: signedBlobWriteURL(
                origin,
                objectKey,
                authState.presignSecret,
            ),
        });
        return;
    }

    if (method === "PUT" && pathname === "/files/video-data") {
        const body = await readJSON(req);
        const fileID = Number(body.fileID);
        store.videoData[fileID.toString()] = {
            fileID,
            objectID: String(body.objectID ?? ""),
            objectSize: Number(body.objectSize ?? 0),
            playlist: String(body.playlist ?? ""),
            playlistHeader: String(body.playlistHeader ?? ""),
            updatedAt: store.nowMicros(),
        };
        // Museum stores the (encrypted) playlist itself as file data so that
        // other clients can discover it via /files/data/fetch and status-diff.
        store.fileData[`${fileID}:vid_preview`] = {
            fileID,
            type: "vid_preview",
            encryptedData: String(body.playlist ?? ""),
            decryptionHeader: String(body.playlistHeader ?? ""),
            updatedAt: store.nowMicros(),
        };
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    // --------------------------------------------------------- remote store

    if (method === "GET" && pathname === "/remote-store") {
        const key = url.searchParams.get("key") ?? "";
        const value = store.remoteStore[key];
        if (value === undefined) {
            sendJSON(res, 200, null);
            return;
        }
        sendJSON(res, 200, { value });
        return;
    }

    if (method === "POST" && pathname === "/remote-store/update") {
        const body = await readJSON(req);
        store.remoteStore[String(body.key ?? "")] = String(body.value ?? "");
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "GET" && pathname === "/remote-store/feature-flags") {
        const rs = store.remoteStore;
        const flags: Record<string, unknown> = {};
        const boolKeys = ["internalUser", "betaUser", "mapEnabled"];
        for (const key of boolKeys) {
            if (rs[key] !== undefined) flags[key] = rs[key] === "true";
        }
        if (rs.serverApiFlag !== undefined) {
            flags.serverApiFlag = Number(rs.serverApiFlag) || 0;
        }
        const stringKeys = ["castUrl", "embedUrl", "customDomain", "customDomainCNAME"];
        for (const key of stringKeys) {
            if (rs[key] !== undefined) flags[key] = rs[key];
        }
        sendJSON(res, 200, flags);
        return;
    }

    // --------------------------------------------------------- user entity

    if (method === "GET" && pathname === "/user-entity/key") {
        const type = url.searchParams.get("type") ?? "";
        const key = store.userEntityKeys[type];
        if (!key) {
            sendJSON(res, 404, { error: "key not found" });
            return;
        }
        sendJSON(res, 200, key);
        return;
    }

    if (method === "POST" && pathname === "/user-entity/key") {
        const body = await readJSON(req);
        store.userEntityKeys[String(body.type ?? "")] = {
            encryptedKey: String(body.encryptedKey ?? ""),
            header: String(body.header ?? ""),
        };
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "GET" && pathname === "/user-entity/entity/diff") {
        const type = url.searchParams.get("type") ?? "";
        const sinceTime = numericParam(url, "sinceTime") ?? 0;
        sendJSON(res, 200, {
            diff: store
                .userEntities(type)
                .filter((e) => e.updatedAt > sinceTime)
                .map((e) => ({
                    id: e.id,
                    encryptedData: e.isDeleted ? null : e.encryptedData,
                    header: e.isDeleted ? null : e.header,
                    isDeleted: e.isDeleted,
                    updatedAt: e.updatedAt,
                })),
        });
        return;
    }

    if (method === "POST" && pathname === "/user-entity/entity") {
        const body = await readJSON(req);
        const type = String(body.type ?? "");
        const entity = {
            id: store.newEntityID(),
            encryptedData: String(body.encryptedData ?? ""),
            header: String(body.header ?? ""),
            isDeleted: false,
            updatedAt: store.nowMicros(),
        };
        store.userEntities(type).push(entity);
        store.markDirty();
        sendJSON(res, 200, { id: entity.id });
        return;
    }

    if (method === "PUT" && pathname === "/user-entity/entity") {
        const body = await readJSON(req);
        const type = String(body.type ?? "");
        const entity = store
            .userEntities(type)
            .find((e) => e.id === String(body.id ?? ""));
        if (!entity) {
            sendJSON(res, 404, { error: "entity not found" });
            return;
        }
        entity.encryptedData = String(body.encryptedData ?? "");
        entity.header = String(body.header ?? "");
        entity.isDeleted = false;
        entity.updatedAt = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "DELETE" && pathname === "/user-entity/entity") {
        const id = url.searchParams.get("id") ?? "";
        for (const type of store.userEntityTypes()) {
            const entity = store
                .userEntities(type)
                .find((e) => e.id === id);
            if (entity) {
                entity.isDeleted = true;
                entity.encryptedData = null;
                entity.header = null;
                entity.updatedAt = store.nowMicros();
                store.markDirty();
                break;
            }
        }
        sendJSON(res, 200, {});
        return;
    }

    // ------------------------------------------------------------- sessions

    if (pathname === "/users/session-validity/v2") {
        sendJSON(res, 200, {});
        return;
    }

    // The vault is local; "logout" on the remote is a no-op, but the client
    // still notifies the (museum-compatible) API, so acknowledge it instead
    // of 404ing into the client's error log on every logout.
    if (pathname === "/users/logout") {
        sendJSON(res, 200, {});
        return;
    }

    // Everything else (deleted remote features) is a clean 404.
    sendJSON(res, 404, { error: "not found" });
};

// ------------------------------------------------------------------ helpers

const etagFor = (data: Buffer) =>
    `"${crypto.createHash("sha256").update(data).digest("hex").slice(0, 32)}"`;

const objectKeyFromURL = (uploadURL: string) => {
    try {
        const u = new URL(uploadURL);
        return decodeURIComponent(u.pathname.replace(/^\/blobs\//, ""));
    } catch {
        return uploadURL.replace(/[^a-zA-Z0-9_.-]/g, "");
    }
};

const parsePartURL = (uploadURL: string): { key: string; part?: number } => {
    try {
        const u = new URL(uploadURL);
        const key = decodeURIComponent(u.pathname.replace(/^\/blobs\//, ""));
        const part = u.searchParams.get("part");
        return part ? { key, part: Number(part) } : { key };
    } catch {
        return { key: uploadURL.replace(/[^a-zA-Z0-9_.-]/g, "") };
    }
};

const completeFromXML = (
    store: LocalVaultStore,
    completeURL: string,
    body: Buffer,
) => {
    const { key } = parsePartURL(completeURL);
    const xml = body.toString("utf8");
    const partNumbers = [...xml.matchAll(/<PartNumber>(\d+)<\/PartNumber>/g)]
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b);
    if (!partNumbers.length) {
        // Without parseable parts, concatenate everything present on disk.
        const prefix = `${store.blobPath(key)}.part`;
        const found: number[] = [];
        for (let n = 1; n <= 10000; n++) {
            try {
                fs.statSync(`${prefix}${n}`);
                found.push(n);
            } catch {
                if (found.length) break;
            }
        }
        if (found.length) store.completeMultipartBlob(key, found);
        return;
    }
    store.completeMultipartBlob(key, partNumbers);
};

const deleteTrashItems = (
    store: LocalVaultStore,
    predicate: (t: {
        isDeleted: boolean;
        isRestored: boolean;
        updatedAt: number;
        file: { id: number };
    }) => boolean,
) => {
    const purgedIDs: number[] = [];
    for (const item of store.trash) {
        if (predicate(item) && !item.isDeleted) {
            item.isDeleted = true;
            item.updatedAt = store.nowMicros();
            purgedIDs.push(item.file.id);
            const file = store.files.find((f) => f.id === item.file.id);
            if (file && !file.isDeleted) {
                file.isDeleted = true;
                file.updationTime = store.nowMicros();
            }
        }
    }
    // Permanent delete: remove the rows and any now-unreferenced blobs.
    store.purgeFiles(purgedIDs);
};

const serveBlob = (
    store: LocalVaultStore,
    req: IncomingMessage,
    res: ServerResponse,
    objectKey: string,
) => {
    const stats = store.statBlob(objectKey);
    if (!stats || !stats.isFile()) {
        sendJSON(res, 404, { error: "blob not found" });
        return;
    }
    const total = stats.size;
    // Range serving on an empty blob is a full-body 200 (a 206 with an
    // inverted/empty Content-Range would be malformed).
    const range = req.headers.range;
    const baseHeaders = {
        ...corsHeaders(),
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
        ETag: etagFor(Buffer.from(objectKey)),
    };
    if (range && total > 0) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        let start = match?.[1] ? Number(match[1]) : 0;
        let end = match?.[2] ? Number(match[2]) : total - 1;
        if (Number.isNaN(start) || start >= total) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
        if (end < start) end = total - 1;
        // A 206 may cover a subset of the requested range: cap it so a
        // hostile `bytes=0-536870911` cannot allocate the blob in RAM.
        end = Math.min(end, start + MAX_RANGE_BYTES - 1);
        const chunk = store.readBlobRange(objectKey, start, end);
        if (!chunk) {
            sendJSON(res, 404, { error: "blob read failed" });
            return;
        }
        res.writeHead(206, {
            ...baseHeaders,
            "Content-Range": `bytes ${start}-${end}/${total}`,
            "Content-Length": chunk.length,
        });
        res.end(chunk);
        return;
    }
    res.writeHead(200, { ...baseHeaders, "Content-Length": total });
    const stream = fs.createReadStream(store.blobPath(objectKey));
    // If the blob vanished (purge race) or resolved to a directory, destroy
    // the socket instead of leaving the response hung forever.
    stream.on("error", () => res.destroy());
    stream.pipe(res);
};
