/**
 * H-05 acceptance: release provenance scaffolding.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const r = spawnSync(process.execPath, ["scripts/write-build-identity.js", "--stage", "dev"], {
  cwd: root,
  encoding: "utf8",
});
assert("write-build-identity exits 0", r.status === 0, r.stderr || r.stdout);

const identityPath = path.join(root, "build-identity.json");
assert("build-identity.json exists", fs.existsSync(identityPath));
const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
assert("gitSha is 40-char hex", /^[0-9a-f]{40}$/i.test(identity.gitSha));
assert("lockHash is sha256 hex", /^[0-9a-f]{64}$/i.test(identity.lockHash));
assert("deployedAt ISO", Boolean(identity.deployedAt && !Number.isNaN(Date.parse(identity.deployedAt))));
assert("migrationVersion set", Boolean(identity.migrationVersion));
assert("stage set", identity.stage === "dev");

const { getBuildIdentity } = require("../src/config/buildIdentity");
process.env.BUILD_GIT_SHA = identity.gitSha;
process.env.BUILD_LOCK_HASH = identity.lockHash;
process.env.BUILD_DEPLOYED_AT = identity.deployedAt;
process.env.BUILD_MIGRATION_VERSION = identity.migrationVersion;
process.env.STAGE = "dev";
const live = getBuildIdentity();
assert("getBuildIdentity mirrors env", live.gitSha === identity.gitSha && live.lockHash === identity.lockHash);

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("versionApi in serverless.yml", /versionApi:/.test(yml) && /path:\s*\/api\/version/.test(yml));
assert("BUILD_GIT_SHA env wired", /BUILD_GIT_SHA:/.test(yml));

assert("versionApi handler exists", fs.existsSync(path.join(root, "src/handlers/versionApi.js")));
assert("deploy-with-identity script exists", fs.existsSync(path.join(root, "scripts/deploy-with-identity.js")));
assert("record-deployment script exists", fs.existsSync(path.join(root, "scripts/record-deployment.js")));
assert("H-05 doc exists", fs.existsSync(path.join(root, "docs/SECURITY_H05_RELEASE_PROVENANCE.md")));
assert("deployments README exists", fs.existsSync(path.join(root, "deployments/README.md")));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("deploy:dev uses identity wrapper", /deploy-with-identity/.test(pkg.scripts["deploy:dev"] || ""));

// Default branch guidance: local main should exist (handover code lives here)
const branches = spawnSync("git", ["branch", "-a"], { cwd: root, encoding: "utf8" });
assert("local main branch exists", /main/.test(branches.stdout || ""));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
