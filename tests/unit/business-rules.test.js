const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  getApprovedBusinessRulesPublic,
  QC_CHECKLIST_11E,
} = require("../../src/config/businessRulesBaseline");
const handler = require("../../src/handlers/businessRulesApi");

describe("H-08 business rules", () => {
  it("publishes fixed 400 and 10 QC checks", () => {
    const r = getApprovedBusinessRulesPublic();
    assert.equal(r.surveyorBalanceFee.rupees, 400);
    assert.equal(r.surveyorBalanceFee.tiers, false);
    assert.equal(r.cadOperatorEarnings.model, "FIXED");
    assert.equal(r.cadOperatorEarnings.payoutRupees, 400);
    assert.equal(QC_CHECKLIST_11E.length, 10);
    assert.equal(r.governmentClaims.allowed, false);
    assert.equal(r.refundPolicy.customerRefundEntitled, false);
    assert.equal(r.refundPolicy.selfServiceRefundEnabled, false);
    assert.ok(String(r.refundPolicy.title || "").length > 0);
    assert.ok(String(r.refundPolicy.summary || "").toLowerCase().includes("non-refundable"));
    assert.equal(typeof r.revisionPaise, "number");
    assert.equal(r.revisionRupees, r.revisionPaise / 100);
    assert.equal(r.pricing.revision.payableRupees, r.revisionRupees);
    assert.equal(r.pricing.revision.paise, r.revisionPaise);
    assert.equal(r.revisionRupees, r.sketchOrderPricing.revisionRupees);
    assert.ok(r.supportContact);
    assert.equal(typeof r.supportContact.configured, "boolean");
  });

  it("GET handler returns ok payload", async () => {
    const res = await handler.handler({});
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.data.qc.checkCount, 10);
  });
});
