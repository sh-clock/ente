import * as path from "node:path";
import type { LocalBackend } from "./server";
import startLocalBackend from "./server";

/**
 * Singleton holder for the local vault backend (the loopback "museum" server).
 *
 * The renderer learns the backend origin via the `localAPIOrigin` IPC, and
 * falls back to the default port when running as a plain web app (e.g. during
 * development, where the backend can be started standalone).
 */

let backend: LocalBackend | undefined;

export const defaultLocalBackendPort = 41119;

export const startLocalBackendIfNeeded = async (
    userDataDir: string,
    log?: (...args: unknown[]) => void,
): Promise<LocalBackend> => {
    if (backend) return backend;
    backend = await startLocalBackend({
        dataDir: path.join(userDataDir, "local-vault"),
        port: Number(process.env.PHOTOS_LOCAL_BACKEND_PORT ?? defaultLocalBackendPort),
        log,
    });
    return backend;
};

export const localBackendOrigin = () => backend?.origin;
