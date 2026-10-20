import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Persistent state for the local vault backend.
 *
 * The local backend implements the subset of the museum API that the Photos
 * web/desktop clients use, backed entirely by files on the user's own disk.
 * Everything the client stores is already end-to-end encrypted by the client;
 * this store treats all payloads as opaque.
 */

export interface StoredCollection {
    id: number;
    owner: { id: number; email: string | null; role: string | null };
    encryptedKey: string;
    keyDecryptionNonce: string | null;
    encryptedName: string | null;
    nameDecryptionNonce: string | null;
    name: string | null;
    type: string;
    sharees: { id: number; email: string | null; role: string | null }[];
    publicURLs: unknown[];
    updationTime: number;
    isDeleted?: boolean;
    magicMetadata?: unknown;
    pubMagicMetadata?: unknown;
    sharedMagicMetadata?: unknown;
}

export interface StoredFile {
    id: number;
    collectionID: number;
    ownerID: number;
    encryptedKey: string;
    keyDecryptionNonce: string;
    file: { objectKey: string; decryptionHeader: string; size: number };
    thumbnail: { objectKey: string; decryptionHeader: string; size: number };
    info?: unknown;
    updationTime: number;
    isDeleted?: boolean;
    metadata: unknown;
    magicMetadata?: unknown;
    pubMagicMetadata?: unknown;
}

export interface StoredTrashItem {
    file: StoredFile;
    isDeleted: boolean;
    isRestored: boolean;
    // Epoch microseconds.
    updatedAt: number;
    // Epoch microseconds; when the item would be auto-deleted.
    deleteBy: number;
}

export interface StoredUserEntity {
    id: string;
    encryptedData: string | null;
    header: string | null;
    isDeleted: boolean;
    // Epoch microseconds.
    updatedAt: number;
}

interface LocalVaultState {
    nextCollectionID: number;
    nextFileID: number;
    collections: StoredCollection[];
    files: StoredFile[];
    trash: StoredTrashItem[];
    // Per-collection tombstones for files that were removed from (but not
    // necessarily globally deleted from) that collection.
    collectionTombstones: Record<
        string,
        { fileID: number; updationTime: number }[]
    >;
    remoteStore: Record<string, string>;
    userEntityKeys: Record<string, { encryptedKey: string; header: string }>;
    userEntities: Record<string, StoredUserEntity[]>;
    fileData: Record<
        string,
        {
            fileID: number;
            type: string;
            encryptedData: string;
            decryptionHeader: string;
            updatedAt: number;
        }
    >;
    videoData: Record<
        string,
        {
            fileID: number;
            objectID: string;
            objectSize: number;
            playlist: string;
            playlistHeader: string;
            updatedAt: number;
        }
    >;
}

const emptyState = (): LocalVaultState => ({
    nextCollectionID: 1,
    nextFileID: 1,
    collections: [],
    files: [],
    trash: [],
    collectionTombstones: {},
    remoteStore: {},
    userEntityKeys: {},
    userEntities: {},
    fileData: {},
    videoData: {},
});

export class LocalVaultStore {
    readonly dataDir: string;
    readonly blobsDir: string;

    private state: LocalVaultState;
    private stateFile: string;
    private lastTime = 0;
    private flushTimer: NodeJS.Timeout | undefined;
    private dirty = false;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
        this.blobsDir = path.join(dataDir, "blobs");
        this.stateFile = path.join(dataDir, "state.json");
        fs.mkdirSync(this.blobsDir, { recursive: true });
        this.state = this.load();
    }

    private load(): LocalVaultState {
        try {
            const raw = fs.readFileSync(this.stateFile, "utf8");
            const parsed = JSON.parse(raw) as Partial<LocalVaultState>;
            return { ...emptyState(), ...parsed };
        } catch {
            return emptyState();
        }
    }

    /** Monotonic epoch-microseconds clock (diffs paginate on updatedAt). */
    nowMicros(): number {
        const now = Date.now() * 1000;
        this.lastTime = Math.max(this.lastTime + 1, now);
        return this.lastTime;
    }

    allocateCollectionID(): number {
        return this.state.nextCollectionID++;
    }

    allocateFileID(): number {
        return this.state.nextFileID++;
    }

    newObjectKey(): string {
        return crypto.randomBytes(16).toString("hex");
    }

    newEntityID(): string {
        return crypto.randomUUID();
    }

    // ---------------------------------------------------------------- state

    get collections(): StoredCollection[] {
        return this.state.collections;
    }

    get files(): StoredFile[] {
        return this.state.files;
    }

    get trash(): StoredTrashItem[] {
        return this.state.trash;
    }

    get remoteStore(): Record<string, string> {
        return this.state.remoteStore;
    }

    get userEntityKeys(): Record<
        string,
        { encryptedKey: string; header: string }
    > {
        return this.state.userEntityKeys;
    }

    userEntities(type: string): StoredUserEntity[] {
        this.state.userEntities[type] ??= [];
        return this.state.userEntities[type];
    }

    userEntityTypes(): string[] {
        return Object.keys(this.state.userEntities);
    }

    get fileData(): LocalVaultState["fileData"] {
        return this.state.fileData;
    }

    get videoData(): LocalVaultState["videoData"] {
        return this.state.videoData;
    }

    tombstonesFor(
        collectionID: number,
    ): { fileID: number; updationTime: number }[] {
        return this.state.collectionTombstones[collectionID.toString()] ?? [];
    }

    addTombstone(
        collectionID: number,
        fileID: number,
        updationTime: number,
    ) {
        const key = collectionID.toString();
        this.state.collectionTombstones[key] ??= [];
        this.state.collectionTombstones[key]!.push({ fileID, updationTime });
        this.markDirty();
    }

    markDirty() {
        this.dirty = true;
        if (this.flushTimer) return;
        this.flushTimer = setTimeout(() => {
            this.flushTimer = undefined;
            this.flush();
        }, 300);
    }

    flush() {
        if (!this.dirty) return;
        this.dirty = false;
        try {
            const tmp = `${this.stateFile}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.state));
            fs.renameSync(tmp, this.stateFile);
        } catch (e) {
            // The in-memory state remains authoritative; retry on next mark.
            this.dirty = true;
            console.error("[local-backend] state flush failed", e);
        }
    }

    // ---------------------------------------------------------------- blobs

    blobPath(objectKey: string): string {
        // Object keys are server-generated hex; guard against traversal anyway.
        const safe = objectKey.replace(/[^a-zA-Z0-9_.-]/g, "");
        return path.join(this.blobsDir, safe);
    }

    writeBlob(objectKey: string, data: Buffer): string {
        const p = this.blobPath(objectKey);
        fs.writeFileSync(p, data);
        return p;
    }

    writeBlobPart(objectKey: string, partNumber: number, data: Buffer) {
        fs.writeFileSync(
            `${this.blobPath(objectKey)}.part${partNumber}`,
            data,
        );
    }

    completeMultipartBlob(objectKey: string, partNumbers: number[]) {
        const target = this.blobPath(objectKey);
        const out = fs.openSync(target, "w");
        try {
            for (const n of partNumbers) {
                const partPath = `${target}.part${n}`;
                const data = fs.readFileSync(partPath);
                fs.writeSync(out, data);
            }
        } finally {
            fs.closeSync(out);
        }
        for (const n of partNumbers) {
            try {
                fs.unlinkSync(`${target}.part${n}`);
            } catch {
                // Best effort cleanup.
            }
        }
        this.markDirty();
    }

    statBlob(objectKey: string): fs.Stats | undefined {
        try {
            return fs.statSync(this.blobPath(objectKey));
        } catch {
            return undefined;
        }
    }

    readBlobRange(
        objectKey: string,
        start: number,
        end: number,
    ): Buffer | undefined {
        try {
            const fd = fs.openSync(this.blobPath(objectKey), "r");
            try {
                const length = end - start + 1;
                const buf = Buffer.alloc(length);
                const read = fs.readSync(fd, buf, 0, length, start);
                return buf.subarray(0, read);
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            return undefined;
        }
    }
}
