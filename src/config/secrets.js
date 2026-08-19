/**
 * Controlled secret resolution (audit H-01).
 * No hardcoded fallback signing keys. Weak / known-leaked values are rejected.
 * Banned values are stored as SHA-256 hashes only — never plaintext secrets in source.
 */

const crypto = require("crypto");
const logger = require("../utils/logger");
const { AppError } = require("../utils/errors");
const { HTTP_STATUS } = require("./constants");

/** SHA-256 hex digests of banned JWT_SECRET values (defaults + known leaked). */
const BANNED_JWT_SECRET_HASHES = new Set([
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", // empty
  "e2186dbdb1bb4193608605e84f33208765b5693b55edd4f730a719a100eeea6f",
  "057ba03d6c44104863dc7361fe4578965d1887360f90a0895882e58a6248fc86",
  "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b",
  "dd8d38af8ca3b7e5cc8990aecfd9bf8ee8d30491fbcdcc53aafd53453ce03e7c",
  "074337dc15c16b74a873232606bc465fc87449ca5f584d9e581e0ee899feb270",
  "048af2438891a89a3536ac09cc96ccbd34a1714e88cf8fdb63e6186dcc3ff89d",
  "6f85d6a0ee433b5d7bf60bc4445a28d4aff40c8c8381e15005b37771a315f625",
  "c1cfd7695bf81909d4ca9f87b4aaab328afa53b42d02de5c135c0fbdec44621f",
]);

function normalizeSecret(value) {
  return String(value || "").trim();
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(normalizeSecret(value), "utf8").digest("hex");
}

function isBannedJwtSecret(value) {
  const v = normalizeSecret(value);
  if (!v) return true;
  if (v.length < 32) return true;
  if (BANNED_JWT_SECRET_HASHES.has(sha256Hex(v))) return true;
  return false;
}

function throwSecretsMisconfigured(logDetail) {
  logger.error("Critical secret misconfiguration (audit H-01)", {
    detail: logDetail,
    hint: "See docs/SECURITY_H01_SECRET_ROTATION.md",
  });
  // Generic client message — never echo secret names/values (avoids new info-disclosure finding).
  throw new AppError("Service configuration error. Contact support.", {
    statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: "SECRETS_MISCONFIGURED",
  });
}

/**
 * Resolve JWT signing secret. Fail closed — never fall back to a code default.
 * SEC-27: production must not boot with a missing/default/leaked JWT_SECRET.
 * @returns {string}
 */
function getJwtSecret() {
  const secret = normalizeSecret(process.env.JWT_SECRET);
  if (isBannedJwtSecret(secret)) {
    throwSecretsMisconfigured("JWT_SECRET missing, too short, or matches banned digest");
  }
  return secret;
}

/**
 * Production-only JWT check (no Mongo). Call from HTTP/job entrypoints (SEC-27).
 * Rejects missing, <32 chars, and SHA-256 of known defaults such as
 * "change-me" and "your-super-secret-jwt-key-change-in-production".
 */
function assertProductionJwtSecret() {
  const { isProductionRuntime } = require("./authSecurity");
  if (!isProductionRuntime()) return;
  getJwtSecret();
}

/**
 * Fail closed if critical env secrets are absent / banned.
 */
function assertCriticalSecretsConfigured() {
  getJwtSecret();
  if (!normalizeSecret(process.env.MONGODB_URI) && !normalizeSecret(process.env.MONGODB_URI_STANDARD)) {
    throwSecretsMisconfigured("MONGODB_URI / MONGODB_URI_STANDARD missing");
  }
  // H-02: fail startup/deploy validation when production has OTP test mode enabled.
  const { isProductionRuntime } = require("./authSecurity");
  if (isProductionRuntime()) {
    const testMode = String(process.env.OTP_TEST_MODE || "").toLowerCase() === "true";
    const common = normalizeSecret(process.env.COMMON_OTP);
    if (testMode || common) {
      throwSecretsMisconfigured("OTP_TEST_MODE / COMMON_OTP enabled in production");
    }
  }
}

module.exports = {
  BANNED_JWT_SECRET_HASHES,
  isBannedJwtSecret,
  getJwtSecret,
  assertProductionJwtSecret,
  assertCriticalSecretsConfigured,
  normalizeSecret,
  sha256Hex,
};
