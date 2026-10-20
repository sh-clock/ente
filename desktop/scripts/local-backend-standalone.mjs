#!/usr/bin/env node
/**
 * Standalone runner for the local vault backend (the loopback "museum"
 * server), used when developing or testing the web build of Photos outside
 * of the Electron shell.
 *
 * Usage:
 *   node scripts/local-backend-standalone.mjs [dataDir] [port]
 *
 * It imports the server compiled by the desktop TypeScript build
 * (npm run build-main in desktop/, or a targeted tsc invocation).
 */

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const dataDir =
    args[0] ?? path.join(__dirname, "..", "..", "tmp", "local-vault");
const port = args[1] ? Number(args[1]) : 41119;

const serverModule = await import(
    path.join(__dirname, "..", "app", "main", "services", "local-backend", "server.js")
);
const startLocalBackend = serverModule.default ?? serverModule.startLocalBackend;

const backend = await startLocalBackend({
    dataDir,
    port,
    portTries: 10,
    log: (...msg) => console.log(new Date().toISOString(), ...msg),
});

console.log(`local-vault backend ready at ${backend.origin}`);
console.log(`data dir: ${dataDir}`);

const shutdown = () => {
    console.log("shutting down...");
    void backend.close().then(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
