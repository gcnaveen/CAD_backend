/**
 * Resolves sketch upload / paid-revision / balance amounts — **server-side only**.
 *
 * Priority:
 * 1. Admin standard-pricing plan + discount (₹) if set
 * 2. Global env fees (`SKETCH_UPLOAD_FEE_PAISE` / `SKETCH_REVISION_FEE_PAISE` / `SKETCH_BALANCE_FEE_PAISE`)
 *
 * Client request amounts (`amount`, `amountRupees`, `amountPaise`) are **never** accepted.
 */

const pricingRepo = require("./sketchStandardPricing.repository");
const {
  getSketchUploadFeePaise,
  getSketchRevisionFeePaise,
  getSketchBalanceFeePaise,
} = require("./phonePeSketchPayment.service");

/** Exported for unit tests (plan − discount, discount capped at plan). */
function payableRupeesFromPlan(planRupees, discountRupees) {
  const p = Number(planRupees);
  if (!Number.isFinite(p) || p < 0) return null;
  const d = Math.max(0, Number(discountRupees) || 0);
  const cappedDisc = Math.min(d, p);
  return Math.max(0, p - cappedDisc);
}

async function resolveSketchUploadFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  const plan = pricing?.sketchUploadPlanAmountRupees;
  if (plan != null && Number.isFinite(Number(plan)) && Number(plan) >= 0) {
    const payRupees = payableRupeesFromPlan(plan, pricing?.sketchUploadDiscountRupees);
    const feePaise = Math.round(Number(payRupees) * 100);
    return {
      feePaise,
      planAmountRupees: Number(plan),
      discountRupees: Math.min(Math.max(0, Number(pricing?.sketchUploadDiscountRupees) || 0), Number(plan)),
      payableRupees: Number(payRupees),
      source: "admin",
    };
  }
  const envPaise = getSketchUploadFeePaise();
  return {
    feePaise: envPaise,
    planAmountRupees: null,
    discountRupees: null,
    payableRupees: envPaise / 100,
    source: envPaise > 0 ? "env" : "none",
  };
}

async function resolveSketchRevisionFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  const plan = pricing?.sketchRevisionPlanAmountRupees;
  if (plan != null && Number.isFinite(Number(plan)) && Number(plan) >= 0) {
    const payRupees = payableRupeesFromPlan(plan, pricing?.sketchRevisionDiscountRupees);
    const feePaise = Math.round(Number(payRupees) * 100);
    return {
      feePaise,
      planAmountRupees: Number(plan),
      discountRupees: Math.min(Math.max(0, Number(pricing?.sketchRevisionDiscountRupees) || 0), Number(plan)),
      payableRupees: Number(payRupees),
      source: "admin",
    };
  }
  const envPaise = getSketchRevisionFeePaise();
  return {
    feePaise: envPaise,
    planAmountRupees: null,
    discountRupees: null,
    payableRupees: envPaise / 100,
    source: envPaise > 0 ? "env" : "none",
  };
}

/** Post-delivery balance fee that unlocks CAD download (audit C-02). */
async function resolveSketchBalanceFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  const plan = pricing?.sketchBalancePlanAmountRupees;
  if (plan != null && Number.isFinite(Number(plan)) && Number(plan) >= 0) {
    const payRupees = payableRupeesFromPlan(plan, pricing?.sketchBalanceDiscountRupees);
    const feePaise = Math.round(Number(payRupees) * 100);
    return {
      feePaise,
      planAmountRupees: Number(plan),
      discountRupees: Math.min(Math.max(0, Number(pricing?.sketchBalanceDiscountRupees) || 0), Number(plan)),
      payableRupees: Number(payRupees),
      source: "admin",
    };
  }
  const envPaise = getSketchBalanceFeePaise();
  return {
    feePaise: envPaise,
    planAmountRupees: null,
    discountRupees: null,
    payableRupees: envPaise / 100,
    source: envPaise > 0 ? "env" : "none",
  };
}

async function getPublicPricingBreakdown() {
  const [upload, revision, balance] = await Promise.all([
    resolveSketchUploadFee(),
    resolveSketchRevisionFee(),
    resolveSketchBalanceFee(),
  ]);
  const { getApprovedBusinessRulesPublic } = require("../config/businessRulesBaseline");
  return {
    upload,
    revision,
    balance,
    // H-08: canonical rules for FE (no tiers; fixed ₹400 balance; one QC list)
    businessRules: getApprovedBusinessRulesPublic(),
  };
}

module.exports = {
  payableRupeesFromPlan,
  resolveSketchUploadFee,
  resolveSketchRevisionFee,
  resolveSketchBalanceFee,
  getPublicPricingBreakdown,
};
