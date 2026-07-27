/**
 * After serverless deploy: retain immutable deployment record (H-05).
 *
 * Usage: node scripts/record-deployment.js --stage dev
 *
 * Writes:
 *   deployments/latest-<stage>.json
 *   deployments/<stage>-<timestamp>-<sha12>.json
 *   deployments/deploy-log.jsonl  (append)
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const deploymentsDir = path.join(root, "deployments");

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return null;
}

function loadIdentity() {
  const p = path.join(root, "build-identity.json");
  if (!fs.existsSync(p)) {
    throw new Error("build-identity.json missing — run write-build-identity.js first");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function tryServerlessInfo(stage) {
  try {
    const out = execSync(`npx serverless info --stage ${stage} --verbose`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    return out.slice(0, 8000);
  } catch (err) {
    return (err.stdout || err.message || "").toString().slice(0, 4000);
  }
}

function main() {
  const stage = argValue("--stage") || process.env.STAGE || "dev";
  const identity = loadIdentity();
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const record = {
    ...identity,
    stage,
    recordedAt: new Date().toISOString(),
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "ap-south-1",
    serverlessInfoExcerpt: tryServerlessInfo(stage),
  };

  const sha12 = String(identity.gitSha || "unknown").slice(0, 12);
  const stamp = record.recordedAt.replace(/[:.]/g, "-");
  const archiveName = `${stage}-${stamp}-${sha12}.json`;
  const archivePath = path.join(deploymentsDir, archiveName);
  const latestPath = path.join(deploymentsDir, `latest-${stage}.json`);
  const logPath = path.join(deploymentsDir, "deploy-log.jsonl");

  fs.writeFileSync(archivePath, `${JSON.stringify(record, null, 2)}\n`);
  fs.writeFileSync(latestPath, `${JSON.stringify(record, null, 2)}\n`);
  fs.appendFileSync(
    logPath,
    `${JSON.stringify({
      recordedAt: record.recordedAt,
      stage,
      gitSha: identity.gitSha,
      lockHash: identity.lockHash,
      migrationVersion: identity.migrationVersion,
      releaseTag: identity.releaseTag,
      archive: archiveName,
    })}\n`
  );

  console.log(`Recorded deployment → ${archivePath}`);
  console.log(`Latest pointer → ${latestPath}`);
  console.log(`Appended → ${logPath}`);
}

main();
