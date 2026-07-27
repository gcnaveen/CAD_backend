/**
 * Safe build / deployment identity for GET /api/version (audit H-05).
 * Prefer Lambda env (baked at deploy); fall back to packaged build-identity.json.
 */

const fs = require("fs");
const path = require("path");
const { MIGRATION_VERSION } = require("./schemaVersion");

let cachedFile = null;

function readPackagedIdentity() {
  if (cachedFile) return cachedFile;
  const candidates = [
    path.join(process.cwd(), "build-identity.json"),
    path.join(__dirname, "..", "..", "build-identity.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        cachedFile = JSON.parse(fs.readFileSync(p, "utf8"));
        return cachedFile;
      }
    } catch {
      // ignore
    }
  }
  cachedFile = {};
  return cachedFile;
}

/**
 * Public, non-secret build metadata.
 * @returns {{
 *   service: string,
 *   stage: string,
 *   gitSha: string,
 *   lockHash: string,
 *   migrationVersion: string,
 *   deployedAt: string|null,
 *   releaseTag: string|null,
 *   nodeEnv: string|null,
 * }}
 */
function getBuildIdentity() {
  const file = readPackagedIdentity();
  return {
    service: "cad-backend-api",
    stage: process.env.STAGE || file.stage || "unknown",
    gitSha: process.env.BUILD_GIT_SHA || file.gitSha || "unknown",
    lockHash: process.env.BUILD_LOCK_HASH || file.lockHash || "unknown",
    migrationVersion:
      process.env.BUILD_MIGRATION_VERSION || file.migrationVersion || MIGRATION_VERSION,
    deployedAt: process.env.BUILD_DEPLOYED_AT || file.deployedAt || null,
    releaseTag: process.env.BUILD_RELEASE_TAG || file.releaseTag || null,
    nodeEnv: process.env.NODE_ENV || null,
  };
}

module.exports = { getBuildIdentity };
