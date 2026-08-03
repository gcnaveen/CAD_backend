#!/usr/bin/env node
/**
 * Deploy with immutable build identity (H-05) + required env gates (H-06).
 * Usage: node scripts/deploy-with-identity.js --stage dev [--tag v1.0.0]
 *
 * TLS verification is always required. Do not set NODE_TLS_REJECT_UNAUTHORIZED=0.
 * If deploy fails with certificate errors, fix the local trust chain (see DEPLOY.md).
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

if (process.argv.includes("--insecure")) {
  console.error(
    "ERROR: --insecure is removed (audit). TLS verification cannot be disabled.\n" +
      "Fix your local CA/proxy trust chain — see DEPLOY.md § TLS / certificate errors."
  );
  process.exit(1);
}

if (String(process.env.NODE_TLS_REJECT_UNAUTHORIZED || "").trim() === "0") {
  console.error(
    "ERROR: NODE_TLS_REJECT_UNAUTHORIZED=0 is forbidden for deploy (audit).\n" +
      "Unset it and repair the trust chain — see DEPLOY.md § TLS / certificate errors."
  );
  process.exit(1);
}

const stage = argValue("--stage");
if (!stage || !["dev", "prod", "staging"].includes(stage)) {
  console.error("ERROR: --stage is required and must be one of: dev | staging | prod");
  process.exit(1);
}
const tag = argValue("--tag");

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

// BIZ-09 / NEW-02 / NEW-04: one sketch pricing contract aligned with H-11
try {
  const { assertSketchOrderPricingReady } = require("../src/config/sketchOrderPricing");
  const sketch = assertSketchOrderPricingReady();
  console.log(
    `BIZ-09 sketch pricing OK: ${sketch.version} → gross ₹${sketch.grossRupees} (booking ₹${sketch.bookingRupees} + balance ₹${sketch.balanceRupees})`
  );
} catch (err) {
  console.error(`ERROR: Sketch pricing contract invalid (BIZ-09): ${err.message}`);
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
  const allowedHosts = new Set(["north-cot.com", "www.north-cot.com"]);
  for (const key of ["PHONEPE_SUCCESS_REDIRECT_URL", "PHONEPE_FAILURE_REDIRECT_URL"]) {
    const raw = String(process.env[key] || "").trim();
    if (!raw) {
      console.error(`ERROR: ${key} is required for prod (no localhost default).`);
      process.exit(1);
    }
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (_) {
      console.error(`ERROR: ${key} is not a valid URL: ${raw}`);
      process.exit(1);
    }
    if (parsed.protocol !== "https:") {
      console.error(`ERROR: ${key} must use HTTPS for prod.`);
      process.exit(1);
    }
    if (/localhost|127\.0\.0\.1/i.test(parsed.hostname)) {
      console.error(`ERROR: ${key} must not point to localhost for prod.`);
      process.exit(1);
    }
    if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
      console.error(
        `ERROR: ${key} must be an HTTPS North-Cot URL (north-cot.com or www.north-cot.com). Got host: ${parsed.hostname}`
      );
      process.exit(1);
    }
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

const slsArgs = ["serverless", "deploy", "--stage", stage];
r = spawnSync("npx", slsArgs, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
if (r.status !== 0) process.exit(r.status || 1);

r = spawnSync(
  process.execPath,
  ["scripts/record-deployment.js", "--stage", stage],
  { cwd: root, stdio: "inherit", env }
);
process.exit(r.status || 0);
