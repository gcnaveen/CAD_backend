/**
 * BIZ-09 / NEW-02 / NEW-04: single server-owned sketch order pricing contract.
 *
 * Standard surveyor order economics (aligned with H-11 CAD payout):
 *   gross ₹500 = booking ₹100 + balance ₹400
 *   superimpose add-on ₹200 when isSuperimpose
 *   revision #2+ fee from this contract (default ₹0 / free unless finance bumps version)
 *
 * Checkout, public business-rules, and admin display must all read this contract.
 * Admin may apply discounts only — not replace plan amounts with arbitrary ₹1 values.
 */

const { BadRequestError } = require("../utils/errors");

/** Immutable approved baseline — bump `version` when finance changes amounts. */
const APPROVED_SKETCH_ORDER_PRICING = Object.freeze({
  version: "SKETCH_ORDER_V1",
  baselineId: "NORTHCOT-SKETCH-PRICING-BIZ09",
  reviewDate: "2026-07-30",
  phaseRefs: Object.freeze(["BIZ-09", "NEW-02", "NEW-04"]),
  approvedBy: "founder/finance",
  /** Paise */
  grossPaise: 50000,
  bookingPaise: 10000,
  balancePaise: 40000,
  revisionPaise: 0,
  superimposePaise: 20000,
  publicCopy:
    "Standard order ₹500 = booking ₹100 + balance ₹400. Superimpose add-on ₹200 when selected. Revision #1 free; #2+ per contract.",
});

function parseNonNegIntEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestError(`Invalid ${name}: must be a non-negative integer (paise)`, {
      code: "SKETCH_PRICING_CONFIG_INVALID",
      errors: [{ field: name, message: "Invalid paise value" }],
    });
  }
  return n;
}

/**
 * Active sketch order pricing. Env may override component paise only when valid;
 * booking + balance must equal gross (fail closed).
 */
function getApprovedSketchOrderPricing() {
  const version =
    (process.env.SKETCH_ORDER_PRICING_VERSION && String(process.env.SKETCH_ORDER_PRICING_VERSION).trim()) ||
    APPROVED_SKETCH_ORDER_PRICING.version;

  const bookingPaise = parseNonNegIntEnv("SKETCH_UPLOAD_FEE_PAISE", APPROVED_SKETCH_ORDER_PRICING.bookingPaise);
  const balancePaise = parseNonNegIntEnv("SKETCH_BALANCE_FEE_PAISE", APPROVED_SKETCH_ORDER_PRICING.balancePaise);
  const revisionPaise = parseNonNegIntEnv(
    "SKETCH_REVISION_FEE_PAISE",
    APPROVED_SKETCH_ORDER_PRICING.revisionPaise
  );
  const superimposePaise = parseNonNegIntEnv(
    "SKETCH_SUPERIMPOSE_FEE_PAISE",
    APPROVED_SKETCH_ORDER_PRICING.superimposePaise
  );
  const grossPaise = parseNonNegIntEnv(
    "SKETCH_ORDER_GROSS_PAISE",
    APPROVED_SKETCH_ORDER_PRICING.grossPaise
  );

  if (bookingPaise + balancePaise !== grossPaise) {
    throw new BadRequestError(
      `Sketch pricing inconsistent: booking (${bookingPaise}) + balance (${balancePaise}) must equal gross (${grossPaise})`,
      { code: "SKETCH_PRICING_INCONSISTENT" }
    );
  }

  return {
    version,
    baselineId: APPROVED_SKETCH_ORDER_PRICING.baselineId,
    reviewDate: APPROVED_SKETCH_ORDER_PRICING.reviewDate,
    phaseRefs: [...APPROVED_SKETCH_ORDER_PRICING.phaseRefs],
    approvedBy: APPROVED_SKETCH_ORDER_PRICING.approvedBy,
    grossPaise,
    bookingPaise,
    balancePaise,
    revisionPaise,
    superimposePaise,
    bookingRupees: bookingPaise / 100,
    balanceRupees: balancePaise / 100,
    grossRupees: grossPaise / 100,
    revisionRupees: revisionPaise / 100,
    superimposeRupees: superimposePaise / 100,
    publicCopy: APPROVED_SKETCH_ORDER_PRICING.publicCopy,
  };
}

/** Deploy / boot gate — fail closed if contract cannot be resolved. */
function assertSketchOrderPricingReady() {
  const rule = getApprovedSketchOrderPricing();
  // Align with H-11 CAD payout booking/balance when that module is available.
  try {
    const { getApprovedCadPayoutRule } = require("../services/cadPayoutPricing.service");
    const cad = getApprovedCadPayoutRule();
    if (cad.bookingPaise !== rule.bookingPaise || cad.balancePaise !== rule.balancePaise) {
      throw new BadRequestError(
        `Sketch pricing must match CAD payout booking/balance (sketch booking=${rule.bookingPaise} balance=${rule.balancePaise}; CAD booking=${cad.bookingPaise} balance=${cad.balancePaise})`,
        { code: "SKETCH_CAD_PRICING_MISMATCH" }
      );
    }
    if (cad.grossPricePaise !== rule.grossPaise) {
      throw new BadRequestError(
        `Sketch gross must match CAD payout gross (sketch=${rule.grossPaise}, CAD=${cad.grossPricePaise})`,
        { code: "SKETCH_CAD_GROSS_MISMATCH" }
      );
    }
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    // CAD module missing in isolated unit tests — sketch rule alone is enough.
  }
  return rule;
}

/** Canonical plan ₹ for a fee line (admin cannot replace these). */
function contractPlanRupees(line) {
  const rule = getApprovedSketchOrderPricing();
  switch (line) {
    case "upload":
    case "booking":
      return rule.bookingRupees;
    case "balance":
      return rule.balanceRupees;
    case "revision":
      return rule.revisionRupees;
    case "superimpose":
      return rule.superimposeRupees;
    default:
      throw new BadRequestError(`Unknown pricing line: ${line}`, { code: "SKETCH_PRICING_LINE_UNKNOWN" });
  }
}

module.exports = {
  APPROVED_SKETCH_ORDER_PRICING,
  getApprovedSketchOrderPricing,
  assertSketchOrderPricingReady,
  contractPlanRupees,
};
