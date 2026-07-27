/**
 * Write build-identity.json + optional shell exports for deploy (H-05).
 *
 * Usage:
 *   node scripts/write-build-identity.js [--stage dev] [--tag v1.2.3]
 *   node scripts/write-build-identity.js --print-env   # KEY=value lines for eval
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const { MIGRATION_VERSION } = require("../src/config/schemaVersion");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return null;
}

function gitSha() {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return process.env.BUILD_GIT_SHA || "unknown";
  }
}

function lockHash() {
  const lockPath = path.join(root, "package-lock.json");
  if (!fs.existsSync(lockPath)) return "missing-package-lock";
  const buf = fs.readFileSync(lockPath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function writeIdentity() {
  const stage = argValue("--stage") || process.env.STAGE || process.env.SLS_STAGE || "dev";
  const releaseTag =
    argValue("--tag") || process.env.BUILD_RELEASE_TAG || process.env.GITHUB_REF_NAME || null;
  const deployedAt = new Date().toISOString();
  const identity = {
    service: "cad-backend-api",
    stage,
    gitSha: gitSha(),
    lockHash: lockHash(),
    migrationVersion: process.env.BUILD_MIGRATION_VERSION || MIGRATION_VERSION,
    deployedAt,
    releaseTag: releaseTag && !String(releaseTag).startsWith("refs/") ? String(releaseTag) : "",
    packageVersion: require(path.join(root, "package.json")).version,
  };

  const outPath = path.join(root, "build-identity.json");
  fs.writeFileSync(outPath, `${JSON.stringify(identity, null, 2)}\n`);

  process.env.BUILD_GIT_SHA = identity.gitSha;
  process.env.BUILD_LOCK_HASH = identity.lockHash;
  process.env.BUILD_DEPLOYED_AT = identity.deployedAt;
  process.env.BUILD_MIGRATION_VERSION = identity.migrationVersion;
  if (identity.releaseTag) process.env.BUILD_RELEASE_TAG = identity.releaseTag;
  process.env.STAGE = stage;

  if (process.argv.includes("--print-env")) {
    console.log(`BUILD_GIT_SHA=${identity.gitSha}`);
    console.log(`BUILD_LOCK_HASH=${identity.lockHash}`);
    console.log(`BUILD_DEPLOYED_AT=${identity.deployedAt}`);
    console.log(`BUILD_MIGRATION_VERSION=${identity.migrationVersion}`);
    if (identity.releaseTag) console.log(`BUILD_RELEASE_TAG=${identity.releaseTag}`);
    console.log(`STAGE=${stage}`);
  } else {
    console.log(`Wrote ${outPath}`);
    console.log(`  gitSha=${identity.gitSha}`);
    console.log(`  lockHash=${identity.lockHash.slice(0, 12)}…`);
    console.log(`  stage=${identity.stage}`);
    console.log(`  migrationVersion=${identity.migrationVersion}`);
    console.log(`  deployedAt=${identity.deployedAt}`);
  }

  return identity;
}

writeIdentity();
module.exports = { writeIdentity };
