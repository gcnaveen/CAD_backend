/**
 * Resolves sketch upload / paid-revision amounts.
 * Priority:
 * 1. Amount sent from frontend (`amount` / `amountRupees` / `amountPaise`) — used as-is for PhonePe
 * 2. Admin standard-pricing plan + discount (₹) if set
 * 3. Global env fees (`SKETCH_*_FEE_PAISE`)
 *
 * Do not hardcode checkout amounts in code.
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

/**
 * Prefer frontend amount when provided (exact paise charged at PhonePe).
 * @param {object} serverResolved
 * @param {number|null|undefined} clientAmountPaise
 */
function applyClientAmountOverride(serverResolved, clientAmountPaise) {
  const n = clientAmountPaise != null ? Math.round(Number(clientAmountPaise)) : null;
  if (n != null && Number.isFinite(n) && n > 0) {
    return {
      feePaise: n,
      planAmountRupees: null,
      discountRupees: null,
      payableRupees: n / 100,
      source: "client",
    };
  }
  return serverResolved;
}

async function resolveSketchUploadFee(clientAmountPaise) {
  const pricing = await getStandardPricingLean();
  const plan = pricing?.sketchUploadPlanAmountRupees;
  let serverResolved;
  if (plan != null && Number.isFinite(Number(plan)) && Number(plan) >= 0) {
    const payRupees = payableRupeesFromPlan(plan, pricing?.sketchUploadDiscountRupees);
    const feePaise = Math.round(Number(payRupees) * 100);
    serverResolved = {
      feePaise,
      planAmountRupees: Number(plan),
      discountRupees: Math.min(Math.max(0, Number(pricing?.sketchUploadDiscountRupees) || 0), Number(plan)),
      payableRupees: Number(payRupees),
      source: "admin",
    };
  } else {
    const envPaise = getSketchUploadFeePaise();
    serverResolved = {
      feePaise: envPaise,
      planAmountRupees: null,
      discountRupees: null,
      payableRupees: envPaise / 100,
      source: envPaise > 0 ? "env" : "none",
    };
  }
  return applyClientAmountOverride(serverResolved, clientAmountPaise);
}

async function resolveSketchRevisionFee(clientAmountPaise) {
  const pricing = await getStandardPricingLean();
  const plan = pricing?.sketchRevisionPlanAmountRupees;
  let serverResolved;
  if (plan != null && Number.isFinite(Number(plan)) && Number(plan) >= 0) {
    const payRupees = payableRupeesFromPlan(plan, pricing?.sketchRevisionDiscountRupees);
    const feePaise = Math.round(Number(payRupees) * 100);
    serverResolved = {
      feePaise,
      planAmountRupees: Number(plan),
      discountRupees: Math.min(Math.max(0, Number(pricing?.sketchRevisionDiscountRupees) || 0), Number(plan)),
      payableRupees: Number(payRupees),
      source: "admin",
    };
  } else {
    const envPaise = getSketchRevisionFeePaise();
    serverResolved = {
      feePaise: envPaise,
      planAmountRupees: null,
      discountRupees: null,
      payableRupees: envPaise / 100,
      source: envPaise > 0 ? "env" : "none",
    };
  }
  return applyClientAmountOverride(serverResolved, clientAmountPaise);
}

async function getPublicPricingBreakdown() {
  const [upload, revision] = await Promise.all([resolveSketchUploadFee(), resolveSketchRevisionFee()]);
  return { upload, revision };
}

module.exports = {
  resolveSketchUploadFee,
  resolveSketchRevisionFee,
  getPublicPricingBreakdown,
  applyClientAmountOverride,
};
