#!/usr/bin/env node
/**
 * Deploy with immutable build identity (H-05) + required env gates (H-06).
 * Usage: node scripts/deploy-with-identity.js --stage dev [--tag v1.0.0] [--insecure]
 */
const { spawnSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

// Match serverless useDotenv: load .env before H-06 required-env checks.
require("dotenv").config({ path: path.join(root, ".env") });

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) {
    return process.argv[i + 1];
  }
  return null;
}

function requireEnv(name, env) {
  const v = String(env[name] || "").trim();
  if (!v) {
    console.error(`ERROR: ${name} is required for deploy (audit H-06 — no unsafe defaults).`);
    process.exit(1);
  }
  return v;
}

const stage = argValue("--stage");
if (!stage || !["dev", "prod", "staging"].includes(stage)) {
  console.error("ERROR: --stage is required and must be one of: dev | staging | prod");
  process.exit(1);
}
const tag = argValue("--tag");
const insecure = process.argv.includes("--insecure");

requireEnv("S3_BUCKET", process.env);
requireEnv("JWT_SECRET", process.env);
if (!String(process.env.MONGODB_URI || "").trim() && !String(process.env.MONGODB_URI_STANDARD || "").trim()) {
  console.error("ERROR: MONGODB_URI or MONGODB_URI_STANDARD is required for deploy.");
  process.exit(1);
}

// H-11: fail closed if CAD payout rule missing/inconsistent (blocks bad release)
try {
  const { assertCadPayoutRuleReady } = require("../src/services/cadPayoutPricing.service");
  const rule = assertCadPayoutRuleReady();
  console.log(
    `H-11 CAD payout rule OK: ${rule.version} → ₹${rule.operatorPayoutPaise / 100} on ₹${rule.grossPricePaise / 100} order`
  );
} catch (err) {
  console.error(`ERROR: CAD payout config invalid (audit H-11): ${err.message}`);
  process.exit(1);
}

// M-01: fail closed on wildcard / missing CORS for staging/prod
try {
  process.env.STAGE = stage;
  const { assertCorsConfigReady } = require("../src/utils/httpSecurity");
  const origins = assertCorsConfigReady();
  const fs = require("fs");
  fs.writeFileSync(
    path.join(root, "cors-origins.json"),
    `${JSON.stringify(origins, null, 2)}\n`,
    "utf8"
  );
  console.log(`M-01 CORS allow-list OK (${origins.length} origin(s)) → cors-origins.json`);
} catch (err) {
  console.error(`ERROR: CORS config invalid (audit M-01): ${err.message}`);
  process.exit(1);
}

if (stage === "prod") {
  if (String(process.env.OTP_TEST_MODE || "").toLowerCase() === "true") {
    console.error("ERROR: OTP_TEST_MODE must not be true for prod deploy.");
    process.exit(1);
  }
  if (String(process.env.PHONEPE_ENV || "").toUpperCase() === "SANDBOX") {
    console.warn("WARN: PHONEPE_ENV=SANDBOX on prod stage — confirm intentional.");
  }
  const success = String(process.env.PHONEPE_SUCCESS_REDIRECT_URL || "");
  if (/localhost/i.test(success)) {
    console.error("ERROR: PHONEPE_SUCCESS_REDIRECT_URL must not point to localhost for prod.");
    process.exit(1);
  }
}

const writeArgs = ["scripts/write-build-identity.js", "--stage", stage];
if (tag) writeArgs.push("--tag", tag);

let r = spawnSync(process.execPath, writeArgs, { cwd: root, stdio: "inherit", env: process.env });
if (r.status !== 0) process.exit(r.status || 1);

const identity = require(path.join(root, "build-identity.json"));
const env = {
  ...process.env,
  BUILD_GIT_SHA: identity.gitSha,
  BUILD_LOCK_HASH: identity.lockHash,
  BUILD_DEPLOYED_AT: identity.deployedAt,
  BUILD_MIGRATION_VERSION: identity.migrationVersion,
  STAGE: stage,
};
if (identity.releaseTag) env.BUILD_RELEASE_TAG = identity.releaseTag;
if (insecure) env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const slsArgs = ["serverless", "deploy", "--stage", stage];
r = spawnSync("npx", slsArgs, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status || 1);

r = spawnSync(
  process.execPath,
  ["scripts/record-deployment.js", "--stage", stage],
  { cwd: root, stdio: "inherit", env }
);
process.exit(r.status || 0);
