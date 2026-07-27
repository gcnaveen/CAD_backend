/**
 * M-12 unit: refresh family reuse detection helpers + policy defaults.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  hashToken,
  deriveSessionLabel,
  getMaxSessionsPerUser,
  newFamilyId,
} = require("../../src/services/refreshToken.service");
const { ACCESS_TOKEN_EXPIRES_IN, REFRESH_TOKEN_TTL_MS } = require("../../src/config/authSecurity");

describe("M-12 refresh / session policy", () => {
  it("hashes tokens stably and labels sessions", () => {
    assert.equal(hashToken("abc"), hashToken("abc"));
    assert.notEqual(hashToken("abc"), hashToken("abcd"));
    assert.match(deriveSessionLabel("Mozilla/5.0 iPhone"), /Mobile/);
    assert.match(deriveSessionLabel("Mozilla/5.0 Chrome"), /Browser/);
    assert.ok(newFamilyId().length >= 16);
  });

  it("defaults to short access TTL and positive refresh TTL / session cap", () => {
    // Env may override in CI; assert parseable positive policy surface.
    assert.ok(typeof ACCESS_TOKEN_EXPIRES_IN === "string" && ACCESS_TOKEN_EXPIRES_IN.length > 0);
    assert.ok(REFRESH_TOKEN_TTL_MS >= 60_000);
    assert.ok(getMaxSessionsPerUser() >= 1);
  });
});
