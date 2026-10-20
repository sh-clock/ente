import { getKVS } from "ente-base/kv";
import { buildEnvCustomAPIEndpoint } from "./env";

export const apiOrigin = async () =>
    // Offline app: the API origin is never contacted; placeholder only.
    (await customAPIOrigin()) ?? "http://127.0.0.1:1";

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

// Custom deployments bypass Photos uploader worker.
export const uploaderOrigin = async () =>
    (await customAPIOrigin()) ?? "http://127.0.0.1:1";
