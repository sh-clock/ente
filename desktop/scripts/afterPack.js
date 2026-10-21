const { rm } = require("node:fs/promises");
const path = require("node:path");

// The fork has no updater (no electron-updater dependency, no update feed).
// electron-builder still emits a stub app-update.yml when it infers a GitHub
// repository from package.json; remove it so the artifact carries no update
// metadata (and no stale "repo: ente" reference).
module.exports = async (context) => {
    const stub = path.join(context.appOutDir, "resources", "app-update.yml");
    await rm(stub, { force: true });
};
