/**
 * H-04 / B4: pricing / state rules (Node built-in test runner).
 * Admin may discount only; plan amounts come from sketch order contract / env.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const pricingRepo = require("../../src/services/sketchStandardPricing.repository");
const {
  payableRupeesFromPlan,
  resolveSketchUploadFee,
  resolveSketchBalanceFee,
  getPublicPricingBreakdown,
} = require("../../src/services/sketchPaymentPricing.service");
const { isDownloadEntitled, isRefunded } = require("../../src/services/cadDownloadEntitlement.service");

describe("pricing: payableRupeesFromPlan", () => {
  it("applies discount", () => {
    assert.equal(payableRupeesFromPlan(500, 100), 400);
  });
  it("caps discount at plan", () => {
    assert.equal(payableRupeesFromPlan(200, 500), 0);
  });
  it("rejects invalid plan", () => {
    assert.equal(payableRupeesFromPlan(-1, 0), null);
    assert.equal(payableRupeesFromPlan("x", 0), null);
  });
});

describe("pricing: resolveSketchUploadFee from contract + discount", () => {
  let orig;
  const envKeys = [
    "SKETCH_UPLOAD_FEE_PAISE",
    "SKETCH_BALANCE_FEE_PAISE",
    "SKETCH_ORDER_GROSS_PAISE",
    "SKETCH_SUPERIMPOSE_FEE_PAISE",
  ];
  const prevEnv = {};

  beforeEach(() => {
    orig = pricingRepo.getStandardPricingLean;
    for (const k of envKeys) {
      prevEnv[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    pricingRepo.getStandardPricingLean = orig;
    for (const k of envKeys) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
  });

  it("applies admin discount on contract booking plan", async () => {
    pricingRepo.getStandardPricingLean = async () => ({
      sketchUploadDiscountRupees: 20,
    });
    const fee = await resolveSketchUploadFee();
    assert.equal(fee.source, "contract+discount");
    assert.equal(fee.planAmountRupees, 100);
    assert.equal(fee.feePaise, 8000);
    assert.equal(fee.payableRupees, 80);
  });

  it("uses contract/env booking when admin unset (fee still > 0)", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    process.env.SKETCH_UPLOAD_FEE_PAISE = "10000";
    process.env.SKETCH_BALANCE_FEE_PAISE = "40000";
    process.env.SKETCH_ORDER_GROSS_PAISE = "50000";
    const fee = await resolveSketchUploadFee();
    assert.ok(fee.feePaise > 0);
    assert.equal(fee.feePaise, 10000);
    assert.equal(fee.superimposeFeePaise, 0);
    assert.match(fee.source, /^contract/);
  });

  it("adds superimpose add-on when isSuperimpose=true", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    process.env.SKETCH_UPLOAD_FEE_PAISE = "10000";
    process.env.SKETCH_BALANCE_FEE_PAISE = "40000";
    process.env.SKETCH_ORDER_GROSS_PAISE = "50000";
    process.env.SKETCH_SUPERIMPOSE_FEE_PAISE = "20000";
    const fee = await resolveSketchUploadFee({ isSuperimpose: true });
    assert.equal(fee.baseFeePaise, 10000);
    assert.equal(fee.superimposeFeePaise, 20000);
    assert.equal(fee.feePaise, 30000);
    assert.equal(fee.payableRupees, 300);
    assert.equal(fee.isSuperimpose, true);
  });

  it("does not add superimpose when flag false", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    process.env.SKETCH_UPLOAD_FEE_PAISE = "10000";
    process.env.SKETCH_BALANCE_FEE_PAISE = "40000";
    process.env.SKETCH_ORDER_GROSS_PAISE = "50000";
    process.env.SKETCH_SUPERIMPOSE_FEE_PAISE = "20000";
    const fee = await resolveSketchUploadFee({ isSuperimpose: false });
    assert.equal(fee.feePaise, 10000);
    assert.equal(fee.superimposeFeePaise, 0);
  });

  it("public breakdown exposes superimpose + uploadWithSuperimpose", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    process.env.SKETCH_UPLOAD_FEE_PAISE = "10000";
    process.env.SKETCH_BALANCE_FEE_PAISE = "40000";
    process.env.SKETCH_ORDER_GROSS_PAISE = "50000";
    process.env.SKETCH_SUPERIMPOSE_FEE_PAISE = "20000";
    const breakdown = await getPublicPricingBreakdown();
    assert.ok(breakdown.superimpose);
    assert.equal(breakdown.superimpose.feePaise, 20000);
    assert.equal(breakdown.upload.feePaise, 10000);
    assert.equal(breakdown.uploadWithSuperimpose.feePaise, 30000);
  });
});

describe("pricing: balance fee resolve", () => {
  let orig;
  beforeEach(() => {
    orig = pricingRepo.getStandardPricingLean;
  });
  afterEach(() => {
    pricingRepo.getStandardPricingLean = orig;
  });

  it("resolves balance from contract", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    const fee = await resolveSketchBalanceFee();
    assert.equal(fee.feePaise, 40000);
    assert.match(fee.source, /^contract/);
  });
});

describe("entitlement state rules", () => {
  it("denies when refunded", () => {
    assert.equal(
      isDownloadEntitled({
        balancePayment: { status: "REFUNDED", amountPaise: 40000, paidAmountPaise: 40000, refundedAt: new Date() },
      }),
      false
    );
    assert.equal(isRefunded({ balancePayment: { status: "REFUNDED" } }), true);
  });

  it("allows waived zero fee", () => {
    assert.equal(
      isDownloadEntitled({ balancePayment: { amountPaise: 0, status: "PENDING" } }),
      true
    );
  });

  it("requires COMPLETED + matching paid for positive fee", () => {
    assert.equal(
      isDownloadEntitled({
        balancePayment: { amountPaise: 40000, status: "COMPLETED", paidAmountPaise: 40000 },
      }),
      true
    );
    assert.equal(
      isDownloadEntitled({
        balancePayment: { amountPaise: 40000, status: "COMPLETED", paidAmountPaise: 39999 },
      }),
      false
    );
    assert.equal(
      isDownloadEntitled({
        balancePayment: { amountPaise: 40000, status: "PENDING", paidAmountPaise: 40000 },
      }),
      false
    );
  });
});
