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
}

const localUser = { id: 1, email: "local@vault", role: "owner" };

const trashRetentionMicros = 30 * 24 * 60 * 60 * 1000 * 1000; // 30 days

const startLocalBackend = (opts: LocalBackendOptions): Promise<LocalBackend> =>
    new Promise((resolve, reject) => {
        const log = opts.log ?? console.log;
        const store = new LocalVaultStore(opts.dataDir);
        const tries = opts.portTries ?? 10;

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
                handle(store, req, res, port, log).catch((e) => {
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
                resolve({ port, origin: `http://127.0.0.1:${port}`, close });
            });
        };

        attempt(0);
    });

export default startLocalBackend;

// --------------------------------------------------------------------- utils

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

    log(`[local-backend] ${method} ${pathname}${url.search}`);

    // ------------------------------------------------------- blob transport

    if (method === "PUT" && pathname === "/file-upload") {
        // Renderer uploader-worker proxy (single object).
        const uploadURL = req.headers["upload-url"];
        if (typeof uploadURL !== "string") {
            sendJSON(res, 400, { error: "missing UPLOAD-URL" });
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
        const body = await readBody(req);
        completeFromXML(store, uploadURL, body);
        sendJSON(res, 200, {});
        return;
    }

    if (method === "PUT" && pathname.startsWith("/blobs/")) {
        const key = decodeURIComponent(pathname.slice("/blobs/".length));
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
        const key = decodeURIComponent(pathname.slice("/blobs/".length));
        const body = await readBody(req);
        completeFromXML(store, `${origin}/blobs/${key}`, body);
        sendJSON(res, 200, {});
        return;
    }

    if (method === "GET" && pathname.startsWith("/blobs/")) {
        serveBlob(store, req, res, decodeURIComponent(pathname.slice("/blobs/".length)));
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
        if (pathname.endsWith("magic-metadata")) {
            collection.magicMetadata = body.magicMetadata;
        } else if (pathname.includes("public")) {
            collection.pubMagicMetadata = body.magicMetadata;
        } else {
            collection.sharedMagicMetadata = body.magicMetadata;
        }
        collection.updationTime = store.nowMicros();
        store.markDirty();
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/collections/add-files") {
        const body = await readJSON(req);
        const collectionID = Number(body.collectionID);
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
            for (const file of store.files) {
                if (file.collectionID === collection.id && !file.isDeleted) {
                    file.isDeleted = true;
                    file.updationTime = updationTime;
                }
            }
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
            ...(body.info !== undefined ? { info: body.info } : {}),
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
        store.markDirty();
        sendJSON(res, 200, { oldToNewFileIDMap });
        return;
    }

    if (method === "POST" && pathname === "/files/trash") {
        const body = await readJSON(req);
        const fileIDs: number[] = (body.fileIDs ?? []).map(Number);
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
        await deleteTrashItems(store, (t) => fileIDs.has(t.file.id));
        sendJSON(res, 200, {});
        return;
    }

    if (method === "POST" && pathname === "/trash/empty") {
        await deleteTrashItems(store, (t) => !t.isDeleted);
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
        for (const item of metadataList) {
            const file = store.files.find((f) => f.id === Number(item.id));
            if (!file) continue;
            if (pathname.includes("public")) {
                file.pubMagicMetadata = item.magicMetadata;
            } else {
                file.magicMetadata = item.magicMetadata;
            }
            file.updationTime = store.nowMicros();
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
            return { objectKey, url: `${origin}/blobs/${objectKey}` };
        });
        sendJSON(res, 200, { urls });
        return;
    }

    if (method === "POST" && pathname === "/files/upload-url") {
        await readJSON(req);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectKey,
            url: `${origin}/blobs/${objectKey}`,
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
                    (_, i) => `${origin}/blobs/${objectKey}?part=${i + 1}`,
                ),
                completeURL: `${origin}/blobs/${objectKey}`,
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
                (_, i) => `${origin}/blobs/${objectKey}?part=${i + 1}`,
            ),
            completeURL: `${origin}/blobs/${objectKey}`,
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
        // Preview (HLS) segments are not generated in local mode; the viewer
        // falls back to progressive playback.
        sendJSON(res, 404, { error: "no preview data" });
        return;
    }

    if (method === "POST" && pathname === "/files/data/preview-upload-url") {
        await readJSON(req);
        const objectKey = store.newObjectKey();
        sendJSON(res, 200, {
            objectKey,
            url: `${origin}/blobs/${objectKey}`,
        });
        return;
    }

    if (method === "PUT" && pathname === "/files/video-data") {
        const body = await readJSON(req);
        store.videoData[Number(body.fileID).toString()] = {
            fileID: Number(body.fileID),
            objectID: String(body.objectID ?? ""),
            objectSize: Number(body.objectSize ?? 0),
            playlist: String(body.playlist ?? ""),
            playlistHeader: String(body.playlistHeader ?? ""),
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
    predicate: (t: { isDeleted: boolean; file: { id: number } }) => boolean,
) => {
    for (const item of store.trash) {
        if (predicate(item) && !item.isDeleted) {
            item.isDeleted = true;
            item.updatedAt = store.nowMicros();
            const file = store.files.find((f) => f.id === item.file.id);
            if (file && !file.isDeleted) {
                file.isDeleted = true;
                file.updationTime = store.nowMicros();
            }
        }
    }
    store.markDirty();
};

const serveBlob = (
    store: LocalVaultStore,
    req: IncomingMessage,
    res: ServerResponse,
    objectKey: string,
) => {
    const stats = store.statBlob(objectKey);
    if (!stats) {
        sendJSON(res, 404, { error: "blob not found" });
        return;
    }
    const total = stats.size;
    const range = req.headers.range;
    const baseHeaders = {
        ...corsHeaders(),
        "Accept-Ranges": "bytes",
        "Content-Type": "application/octet-stream",
        ETag: etagFor(Buffer.from(objectKey)),
    };
    if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        let start = match?.[1] ? Number(match[1]) : 0;
        let end = match?.[2] ? Number(match[2]) : total - 1;
        if (Number.isNaN(start) || start >= total) start = 0;
        if (Number.isNaN(end) || end >= total) end = total - 1;
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
    stream.pipe(res);
};
