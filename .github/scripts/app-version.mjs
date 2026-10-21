#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../..");
const [app, command, ...args] = process.argv.slice(2);

const scripts = {
    photos: ["flutter-version.mjs", "photos"],
    "photos-desktop": ["photos-desktop-version.mjs"],
};

const versionFiles = {
    photos: ["mobile/apps/photos/pubspec.yaml"],
    "photos-desktop": ["desktop/package.json"],
};

function usage() {
    console.error(`Usage: node .github/scripts/app-version.mjs <app> <command> [args]

Commands are forwarded to the app's version script, plus:
  set-build-and-commit 0.1.16 34    set version and build number, then commit
  bump-build-and-commit             bump the build number, then commit (no-op for photos-desktop)

Valid apps: ${Object.keys(scripts).join(", ")}`);
}

if (!scripts[app] || !command) {
    usage();
    process.exit(2);
}

function run(cmd, cmdArgs = [], opts = {}) {
    const [script, ...prefix] = scripts[app];
    return execFileSync(
        "node",
        [path.join(dir, script), ...prefix, cmd, ...cmdArgs],
        { encoding: "utf8", ...opts },
    );
}

function commitVersion() {
    const capture = { stdio: ["ignore", "pipe", "inherit"] };
    const version = run("get", [], capture).trim();
    const build = run("get-build-base", [], capture).trim();
    const title = app[0].toUpperCase() + app.slice(1);
    execFileSync(
        "git",
        [
            "commit",
            "-m",
            `${title} ${version}+${build}`,
            "--",
            ...versionFiles[app],
        ],
        { cwd: root, stdio: "inherit" },
    );
}

try {
    if (command === "bump-build-and-commit") {
        if (app === "photos-desktop") {
            console.error(`${app} has no build number; nothing to do`);
            process.exit(0);
        }
        run("bump-build");
        commitVersion();
    } else if (command === "set-build-and-commit") {
        run("set-build", args);
        commitVersion();
    } else {
        run(command, args, { stdio: "inherit" });
    }
} catch (error) {
    process.exit(error.status ?? 1);
}
