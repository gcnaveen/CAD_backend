/**
 * M-09 unit: auto-assign policy, override gate, backoff.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getPolicy,
  isManualOverrideAllowed,
  AUTO_ASSIGN_STATE,
} = require("../../src/services/autoAssign.service");

describe("M-09 auto-assign", () => {
  it("exposes retry / override policy", () => {
    const p = getPolicy();
    assert.ok(p.maxAttempts >= 1);
    assert.ok(p.retryBaseMs >= 1000);
    assert.ok(p.manualOverrideMs >= 1000);
    assert.ok(p.lockTtlMs >= 1000);
  });

  it("allows manual override on EXCEPTION or past timeout", () => {
    assert.equal(
      isManualOverrideAllowed({ state: AUTO_ASSIGN_STATE.EXCEPTION }),
      true
    );
    assert.equal(
      isManualOverrideAllowed({
        state: AUTO_ASSIGN_STATE.PENDING_RETRY,
        manualOverrideAllowedAt: new Date(Date.now() - 1000),
      }),
      true
    );
    assert.equal(
      isManualOverrideAllowed({
        state: AUTO_ASSIGN_STATE.PENDING_RETRY,
        manualOverrideAllowedAt: new Date(Date.now() + 60_000),
      }),
      false
    );
  });
});
