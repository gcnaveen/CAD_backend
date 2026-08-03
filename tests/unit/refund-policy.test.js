/**
 * Unified refund policy unit tests.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getApprovedRefundPolicy,
  assertExceptionalAdminRefundAllowed,
} = require("../../src/config/refundPolicy");
const { getApprovedBusinessRulesPublic } = require("../../src/config/businessRulesBaseline");
const { BadRequestError } = require("../../src/utils/errors");

describe("refund policy unified", () => {
  it("is non-refundable for customers", () => {
    const p = getApprovedRefundPolicy();
    assert.equal(p.customerRefundEntitled, false);
    assert.equal(p.selfServiceRefundEnabled, false);
    assert.ok(p.termsCopyApproved.toLowerCase().includes("non-refundable"));
  });

  it("embeds in public business-rules", () => {
    const r = getApprovedBusinessRulesPublic();
    assert.equal(r.refundPolicy.customerRefundEntitled, false);
    assert.ok(Array.isArray(r.refundPolicy.prohibitedCopy));
    assert.ok(r.refundPolicy.prohibitedCopy.some((c) => /money-back/i.test(c)));
  });

  it("admin exceptional refund requires reasonCode + note", () => {
    assert.throws(
      () => assertExceptionalAdminRefundAllowed({ reasonCode: "DUPLICATE_CHARGE" }),
      (e) => e instanceof BadRequestError && e.code === "REFUND_NOTE_REQUIRED"
    );
    const ok = assertExceptionalAdminRefundAllowed({
      reasonCode: "FOUNDER_GOODWILL",
      reason: "Documented goodwill case",
    });
    assert.equal(ok.reasonCode, "FOUNDER_GOODWILL");
    assert.equal(ok.policyVersion, getApprovedRefundPolicy().version);
  });
});
