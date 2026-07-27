/**
 * H-11: CAD fixed ₹400 payout (not 20%).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  getApprovedCadPayoutRule,
  computeCadPayoutSettlement,
  APPROVED_CAD_PAYOUT_RULE,
} = require("../../src/services/cadPayoutPricing.service");
const { CAD_WALLET_ENTRY_KIND } = require("../../src/config/constants");
const { getApprovedBusinessRulesPublic } = require("../../src/config/businessRulesBaseline");

describe("H-11 CAD payout rule", () => {
  const keys = [
    "CAD_PAYOUT_RULE_VERSION",
    "CAD_OPERATOR_PAYOUT_PAISE",
    "CAD_PAYOUT_GROSS_PAISE",
    "CAD_PAYOUT_BOOKING_PAISE",
    "CAD_PAYOUT_BALANCE_PAISE",
    "CAD_PAYOUT_PLATFORM_FEE_PAISE",
    "CAD_PAYOUT_TAX_PAISE",
    "CAD_PAYOUT_ADJUSTMENT_PAISE",
  ];
  const prev = {};

  before(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("standard ₹500 order credits CAD ₹400 not ₹100", () => {
    const rule = getApprovedCadPayoutRule();
    assert.equal(rule.grossPricePaise, 50000);
    assert.equal(rule.operatorPayoutPaise, 40000);
    assert.notEqual(rule.operatorPayoutPaise, Math.round((50000 * 20) / 100));

    const { amountPaise, breakdown } = computeCadPayoutSettlement({
      kind: CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY,
      sourcePaidPaise: 50000,
    });
    assert.equal(amountPaise, 40000);
    assert.equal(breakdown.pricingRuleVersion, APPROVED_CAD_PAYOUT_RULE.version);
    assert.equal(breakdown.payoutModel, "FIXED");
    assert.equal(breakdown.bookingPaise, 10000);
    assert.equal(breakdown.balancePaise, 40000);
    assert.equal(breakdown.platformFeePaise, 10000);
  });

  it("public business rules expose FIXED not percent", () => {
    const r = getApprovedBusinessRulesPublic();
    assert.equal(r.cadOperatorEarnings.model, "FIXED");
    assert.equal(r.cadOperatorEarnings.payoutRupees, 400);
    assert.equal(r.cadOperatorEarnings.percent, null);
  });

  it("inconsistent config fails closed", () => {
    process.env.CAD_OPERATOR_PAYOUT_PAISE = "40000";
    process.env.CAD_PAYOUT_GROSS_PAISE = "50000";
    process.env.CAD_PAYOUT_BOOKING_PAISE = "10000";
    process.env.CAD_PAYOUT_BALANCE_PAISE = "30000"; // broken
    assert.throws(() => getApprovedCadPayoutRule(), (err) => err.code === "CAD_PAYOUT_CONFIG_INVALID");
    delete process.env.CAD_PAYOUT_BALANCE_PAISE;
  });

  it("zero operator payout fails closed", () => {
    process.env.CAD_OPERATOR_PAYOUT_PAISE = "0";
    process.env.CAD_PAYOUT_GROSS_PAISE = "0";
    process.env.CAD_PAYOUT_BOOKING_PAISE = "0";
    process.env.CAD_PAYOUT_BALANCE_PAISE = "0";
    process.env.CAD_PAYOUT_PLATFORM_FEE_PAISE = "0";
    assert.throws(() => getApprovedCadPayoutRule(), (err) => err.code === "CAD_PAYOUT_CONFIG_MISSING");
    for (const k of keys) delete process.env[k];
  });
});
