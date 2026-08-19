/**
 * SEC-27 / H-01: JWT_SECRET must not fall back to a default.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  getJwtSecret,
  isBannedJwtSecret,
  assertProductionJwtSecret,
} = require("../../src/config/secrets");
const { AppError } = require("../../src/utils/errors");

const KEYS = ["JWT_SECRET", "NODE_ENV", "STAGE"];

describe("SEC-27 JWT_SECRET fail-closed", () => {
  const prev = {};

  beforeEach(() => {
    for (const k of KEYS) prev[k] = process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("rejects missing secret", () => {
    delete process.env.JWT_SECRET;
    assert.throws(
      () => getJwtSecret(),
      (e) => e instanceof AppError && e.code === "SECRETS_MISCONFIGURED"
    );
  });

  it("rejects change-me and short values", () => {
    assert.equal(isBannedJwtSecret("change-me"), true);
    process.env.JWT_SECRET = "change-me";
    assert.throws(() => getJwtSecret(), (e) => e.code === "SECRETS_MISCONFIGURED");
  });

  it("rejects the historical middleware default", () => {
    process.env.JWT_SECRET = "your-super-secret-jwt-key-change-in-production";
    assert.throws(() => getJwtSecret(), (e) => e.code === "SECRETS_MISCONFIGURED");
  });

  it("accepts a strong non-banned secret", () => {
    process.env.JWT_SECRET = "ci-quality-gate-jwt-secret-32chars-min";
    assert.equal(getJwtSecret().length >= 32, true);
  });

  it("production hard-fails when JWT_SECRET is unset", () => {
    process.env.NODE_ENV = "production";
    process.env.STAGE = "prod";
    delete process.env.JWT_SECRET;
    assert.throws(
      () => assertProductionJwtSecret(),
      (e) => e.code === "SECRETS_MISCONFIGURED"
    );
  });
});
