/**
 * H-04: pricing / state rules (Node built-in test runner).
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const pricingRepo = require("../../src/services/sketchStandardPricing.repository");
const {
  payableRupeesFromPlan,
  resolveSketchUploadFee,
  resolveSketchBalanceFee,
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

describe("pricing: resolveSketchUploadFee from admin plan", () => {
  let orig;
  beforeEach(() => {
    orig = pricingRepo.getStandardPricingLean;
  });
  afterEach(() => {
    pricingRepo.getStandardPricingLean = orig;
  });

  it("uses admin plan − discount in paise", async () => {
    pricingRepo.getStandardPricingLean = async () => ({
      sketchUploadPlanAmountRupees: 500,
      sketchUploadDiscountRupees: 100,
    });
    const fee = await resolveSketchUploadFee();
    assert.equal(fee.source, "admin");
    assert.equal(fee.feePaise, 40000);
    assert.equal(fee.payableRupees, 400);
  });

  it("falls back to env when no admin plan", async () => {
    pricingRepo.getStandardPricingLean = async () => ({});
    const prev = process.env.SKETCH_UPLOAD_FEE_PAISE;
    process.env.SKETCH_UPLOAD_FEE_PAISE = "12345";
    try {
      const fee = await resolveSketchUploadFee();
      assert.equal(fee.source, "env");
      assert.equal(fee.feePaise, 12345);
    } finally {
      if (prev == null) delete process.env.SKETCH_UPLOAD_FEE_PAISE;
      else process.env.SKETCH_UPLOAD_FEE_PAISE = prev;
    }
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

  it("resolves balance admin plan", async () => {
    pricingRepo.getStandardPricingLean = async () => ({
      sketchBalancePlanAmountRupees: 400,
      sketchBalanceDiscountRupees: 0,
    });
    const fee = await resolveSketchBalanceFee();
    assert.equal(fee.feePaise, 40000);
    assert.equal(fee.source, "admin");
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
