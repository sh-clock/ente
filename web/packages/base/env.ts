// The build replaces these process.env reads in browser bundles.
declare const process: {
    readonly env: {
        readonly NODE_ENV: "development" | "production" | "test";
        // Build-time API origin override (inlined by Next.js for NEXT_PUBLIC_*
        // vars). Unset by default; the KVS "apiOrigin" key is the primary
        // runtime seam (see origins.ts and docs/PROTOCOL-INTEGRATION.md).
        readonly NEXT_PUBLIC_PHOTOS_API_ENDPOINT?: string;
        readonly appName: string;
        readonly desktopAppVersion?: string;
        readonly gitSHA?: string;
        readonly isDesktop: "" | "1";
    };
};

export const isDevBuild = process.env.NODE_ENV == "development";
export const buildEnvIsProductionBuild = process.env.NODE_ENV == "production";

export const buildEnvCustomAPIEndpoint =
    process.env.NEXT_PUBLIC_PHOTOS_API_ENDPOINT;
export const buildEnvAppName = process.env.appName;
export const buildEnvIsDesktop = process.env.isDesktop == "1";
export const buildEnvDesktopAppVersion = process.env.desktopAppVersion;
export const buildEnvGitSHA = process.env.gitSHA;

// Keep these as functions; SSR would inline constants with the server value.
export const haveWindow = () => typeof window != "undefined";

export const inWorker = () => typeof importScripts == "function";
