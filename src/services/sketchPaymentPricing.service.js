/**
 * Resolves sketch upload / paid-revision / balance / superimpose amounts — **server-side only**.
 *
 * Single server-owned contract (BIZ-09 / NEW-02 / NEW-04):
 *   `src/config/sketchOrderPricing.js` → booking ₹100 + balance ₹400 = ₹500 (+ superimpose ₹200)
 *
 * Admin may apply **discounts only** (cannot replace plan with ₹1 / arbitrary amounts).
 * Client request amounts are **never** accepted.
 *
 * When `isSuperimpose` is true, upload charge = booking + superimpose add-on.
 */

const pricingRepo = require("./sketchStandardPricing.repository");
const {
  getApprovedSketchOrderPricing,
  contractPlanRupees,
} = require("../config/sketchOrderPricing");

/** Exported for unit tests (plan − discount, discount capped at plan). */
function payableRupeesFromPlan(planRupees, discountRupees) {
  const p = Number(planRupees);
  if (!Number.isFinite(p) || p < 0) return null;
  const d = Math.max(0, Number(discountRupees) || 0);
  const cappedDisc = Math.min(d, p);
  return Math.max(0, p - cappedDisc);
}

/**
 * @param {"upload"|"balance"|"revision"|"superimpose"} line
 * @param {object|null} pricing admin lean doc
 * @param {string} discountKey
 */
function resolveContractLine(line, pricing, discountKey) {
  const contract = getApprovedSketchOrderPricing();
  const planRupees = contractPlanRupees(line);
  const rawDisc = pricing?.[discountKey];
  const discountRupees =
    rawDisc != null && Number.isFinite(Number(rawDisc)) ? Math.max(0, Number(rawDisc)) : 0;
  const cappedDisc = Math.min(discountRupees, planRupees);
  const payRupees = payableRupeesFromPlan(planRupees, cappedDisc);
  const feePaise = Math.round(Number(payRupees) * 100);
  return {
    feePaise,
    planAmountRupees: planRupees,
    discountRupees: cappedDisc,
    payableRupees: Number(payRupees),
    source: cappedDisc > 0 ? "contract+discount" : "contract",
    contractVersion: contract.version,
    baselineId: contract.baselineId,
  };
}

async function resolveSuperimposeFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  return resolveContractLine("superimpose", pricing, "sketchSuperimposeDiscountRupees");
}

/**
 * @param {{ isSuperimpose?: boolean }} [options]
 */
async function resolveSketchUploadFee(options = {}) {
  const isSuperimpose = options.isSuperimpose === true;
  const pricing = await pricingRepo.getStandardPricingLean();
  const base = resolveContractLine("upload", pricing, "sketchUploadDiscountRupees");

  let superimpose = {
    feePaise: 0,
    planAmountRupees: null,
    discountRupees: null,
    payableRupees: 0,
    source: "none",
  };
  if (isSuperimpose) {
    superimpose = await resolveSuperimposeFee();
  }

  const feePaise = Math.round(Number(base.feePaise) || 0) + Math.round(Number(superimpose.feePaise) || 0);
  return {
    feePaise,
    planAmountRupees: base.planAmountRupees,
    discountRupees: base.discountRupees,
    payableRupees: feePaise / 100,
    source: base.source,
    contractVersion: base.contractVersion,
    baselineId: base.baselineId,
    baseFeePaise: Math.round(Number(base.feePaise) || 0),
    superimposeFeePaise: Math.round(Number(superimpose.feePaise) || 0),
    isSuperimpose,
    superimpose: isSuperimpose ? superimpose : null,
  };
}

async function resolveSketchRevisionFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  return resolveContractLine("revision", pricing, "sketchRevisionDiscountRupees");
}

/** Post-delivery balance fee that unlocks CAD download (audit C-02). */
async function resolveSketchBalanceFee() {
  const pricing = await pricingRepo.getStandardPricingLean();
  return resolveContractLine("balance", pricing, "sketchBalanceDiscountRupees");
}

async function getPublicPricingBreakdown() {
  const contract = getApprovedSketchOrderPricing();
  const [upload, revision, balance, superimpose] = await Promise.all([
    resolveSketchUploadFee({ isSuperimpose: false }),
    resolveSketchRevisionFee(),
    resolveSketchBalanceFee(),
    resolveSuperimposeFee(),
  ]);
  const { getApprovedBusinessRulesPublic } = require("../config/businessRulesBaseline");
  const uploadWithSuperimpose = await resolveSketchUploadFee({ isSuperimpose: true });
  return {
    /** Single server-owned contract — FE must prefer this over hard-coded ₹500. */
    pricingContract: {
      version: contract.version,
      baselineId: contract.baselineId,
      reviewDate: contract.reviewDate,
      phaseRefs: contract.phaseRefs,
      grossRupees: contract.grossRupees,
      bookingRupees: contract.bookingRupees,
      balanceRupees: contract.balanceRupees,
      revisionRupees: contract.revisionRupees,
      superimposeRupees: contract.superimposeRupees,
      publicCopy: contract.publicCopy,
    },
    upload,
    revision,
    balance,
    superimpose,
    uploadWithSuperimpose,
    businessRules: getApprovedBusinessRulesPublic(),
  };
}

module.exports = {
  payableRupeesFromPlan,
  resolveSketchUploadFee,
  resolveSketchRevisionFee,
  resolveSketchBalanceFee,
  resolveSuperimposeFee,
  getPublicPricingBreakdown,
};
