/**
 * Resolves sketch upload / paid-revision amounts — **standard for all sketches**:
 * admin standard-pricing plan + discount (₹) if set, else global env fees (`SKETCH_*_FEE_PAISE`).
 * Per-request amounts from clients are not accepted.
 */

const { getStandardPricingLean } = require("./sketchStandardPricing.repository");
const {
  getSketchUploadFeePaise,
  getSketchRevisionFeePaise,
} = require("./phonePeSketchPayment.service");

function payableRupeesFromPlan(planRupees, discountRupees) {
  const p = Number(planRupees);
  if (!Number.isFinite(p) || p < 0) return null;
  const d = Math.max(0, Number(discountRupees) || 0);
  const cappedDisc = Math.min(d, p);
  return Math.max(0, p - cappedDisc);
}

async function resolveSketchUploadFee() {
  const pricing = await getStandardPricingLean();
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
  const pricing = await getStandardPricingLean();
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

async function getPublicPricingBreakdown() {
  const [upload, revision] = await Promise.all([resolveSketchUploadFee(), resolveSketchRevisionFee()]);
  return { upload, revision };
}

module.exports = {
  resolveSketchUploadFee,
  resolveSketchRevisionFee,
  getPublicPricingBreakdown,
};
