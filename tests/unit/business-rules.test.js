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
  });

  it("GET handler returns ok payload", async () => {
    const res = await handler.handler({});
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.data.qc.checkCount, 10);
  });
});
