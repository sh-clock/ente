import { getKVS } from "ente-base/kv";
import { buildEnvCustomAPIEndpoint } from "./env";

/**
 * The app's "API origin" is a loopback server embedded in the desktop app
 * (or running standalone next to a web build). It serves the museum-compatible
 * API that backs the local vault, so the app works fully offline.
 */
const defaultLocalAPIOrigin = "http://127.0.0.1:41119";

export const localAPIOrigin = async (): Promise<string> => {
    try {
        return (await globalThis.electron?.localAPIOrigin?.()) ?? defaultLocalAPIOrigin;
    } catch {
        return defaultLocalAPIOrigin;
    }
};

export const apiOrigin = async () =>
    (await customAPIOrigin()) ?? (await localAPIOrigin());

// path must begin with "/".
export const apiURL = async (
    path: string,
    queryParams?: Record<string, string | number | boolean>,
) => {
    let url = (await apiOrigin()) + path;
    if (queryParams) {
        const stringQP = Object.fromEntries(
            Object.entries(queryParams).map(([k, v]) => [k, v.toString()]),
        );
        const params = new URLSearchParams(stringQP);
        url = `${url}?${params.toString()}`;
    }
    return url;
};

export const customAPIOrigin = async () =>
    (await getKVS("apiOrigin")) ?? buildEnvCustomAPIEndpoint ?? undefined;

// This ignores the KV custom server and only reflects the build-time override.
export const isCustomAPIOrigin = !!buildEnvCustomAPIEndpoint;

export const customAPIHost = async () => {
    const origin = await customAPIOrigin();
    return origin ? new URL(origin).host : undefined;
};

// The local backend also proxies large binary uploads for the renderer.
export const uploaderOrigin = async () =>
    (await customAPIOrigin()) ?? (await localAPIOrigin());
