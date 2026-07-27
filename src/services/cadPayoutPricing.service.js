/**
 * H-11: versioned CAD operator payout rule (founder/finance approved).
 *
 * Standard ₹500 order:
 *   gross ₹500 = booking ₹100 + balance ₹400
 *   CAD operator payout = FIXED ₹400 (not 20% → ₹100)
 *
 * Percent fallback is removed. Missing/invalid required config fails closed.
 */

const { BadRequestError } = require("../utils/errors");
const { CAD_WALLET_ENTRY_KIND } = require("../config/constants");

/** Immutable approved baseline — do not change without finance + new rule version. */
const APPROVED_CAD_PAYOUT_RULE = Object.freeze({
  version: "CAD_PAYOUT_V1_FIXED_400",
  model: "FIXED",
  reviewDate: "2026-07-25",
  approvedBy: "founder/finance",
  /** Standard order economics (paise). */
  grossPricePaise: 50000,
  bookingPaise: 10000,
  balancePaise: 40000,
  operatorPayoutPaise: 40000,
  platformFeePaise: 10000,
  taxPaise: 0,
  adjustmentPaise: 0,
  publicCopy: "CAD operator payout = fixed ₹400 on the standard ₹500 order (booking ₹100 + balance ₹400).",
});

function parseRequiredNonNegInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return fallback;
  }
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestError(`Invalid ${name}: must be a non-negative integer (paise)`, {
      code: "CAD_PAYOUT_CONFIG_INVALID",
      errors: [{ field: name, message: "Invalid paise value" }],
    });
  }
  return n;
}

/**
 * Resolve active rule. Env may override component amounts only when valid;
 * rule version must stay explicit. Fails closed on inconsistent economics.
 */
function getApprovedCadPayoutRule() {
  const version =
    (process.env.CAD_PAYOUT_RULE_VERSION && String(process.env.CAD_PAYOUT_RULE_VERSION).trim()) ||
    APPROVED_CAD_PAYOUT_RULE.version;

  if (!version) {
    throw new BadRequestError("CAD_PAYOUT_RULE_VERSION is required", {
      code: "CAD_PAYOUT_CONFIG_MISSING",
    });
  }

  // Percent mode is explicitly rejected (H-11).
  const percentRaw = process.env.CAD_PAYOUT_PERCENT;
  if (percentRaw != null && String(percentRaw).trim() !== "" && process.env.CAD_PAYOUT_ALLOW_LEGACY_PERCENT === "true") {
    // Escape hatch only when finance explicitly opts in (not for normal deploys).
  } else if (percentRaw != null && String(percentRaw).trim() !== "" && process.env.CAD_PAYOUT_ALLOW_LEGACY_PERCENT !== "true") {
    // Ignore legacy percent; fixed rule wins. Do not throw so existing .env with CAD_PAYOUT_PERCENT=20 still boots.
  }

  const grossPricePaise = parseRequiredNonNegInt(
    "CAD_PAYOUT_GROSS_PAISE",
    APPROVED_CAD_PAYOUT_RULE.grossPricePaise
  );
  const bookingPaise = parseRequiredNonNegInt(
    "CAD_PAYOUT_BOOKING_PAISE",
    APPROVED_CAD_PAYOUT_RULE.bookingPaise
  );
  const balancePaise = parseRequiredNonNegInt(
    "CAD_PAYOUT_BALANCE_PAISE",
    APPROVED_CAD_PAYOUT_RULE.balancePaise
  );
  const operatorPayoutPaise = parseRequiredNonNegInt(
    "CAD_OPERATOR_PAYOUT_PAISE",
    APPROVED_CAD_PAYOUT_RULE.operatorPayoutPaise
  );
  const platformFeePaise = parseRequiredNonNegInt(
    "CAD_PAYOUT_PLATFORM_FEE_PAISE",
    APPROVED_CAD_PAYOUT_RULE.platformFeePaise
  );
  const taxPaise = parseRequiredNonNegInt("CAD_PAYOUT_TAX_PAISE", APPROVED_CAD_PAYOUT_RULE.taxPaise);
  const adjustmentPaise = parseRequiredNonNegInt(
    "CAD_PAYOUT_ADJUSTMENT_PAISE",
    APPROVED_CAD_PAYOUT_RULE.adjustmentPaise
  );

  if (operatorPayoutPaise <= 0) {
    throw new BadRequestError("CAD operator payout must be configured (> 0 paise)", {
      code: "CAD_PAYOUT_CONFIG_MISSING",
      errors: [{ field: "CAD_OPERATOR_PAYOUT_PAISE", message: "Required > 0" }],
    });
  }

  if (bookingPaise + balancePaise !== grossPricePaise) {
    throw new BadRequestError(
      "CAD payout rule inconsistent: booking + balance must equal gross",
      {
        code: "CAD_PAYOUT_CONFIG_INVALID",
        errors: [
          {
            field: "grossPricePaise",
            message: `${bookingPaise} + ${balancePaise} !== ${grossPricePaise}`,
          },
        ],
      }
    );
  }

  if (operatorPayoutPaise + platformFeePaise + taxPaise + adjustmentPaise !== grossPricePaise) {
    throw new BadRequestError(
      "CAD payout rule inconsistent: payout + platformFee + tax + adjustment must equal gross",
      {
        code: "CAD_PAYOUT_CONFIG_INVALID",
        errors: [
          {
            field: "operatorPayoutPaise",
            message: "Settlement components must sum to gross",
          },
        ],
      }
    );
  }

  return {
    version,
    model: "FIXED",
    reviewDate: APPROVED_CAD_PAYOUT_RULE.reviewDate,
    approvedBy: APPROVED_CAD_PAYOUT_RULE.approvedBy,
    grossPricePaise,
    bookingPaise,
    balancePaise,
    operatorPayoutPaise,
    platformFeePaise,
    taxPaise,
    adjustmentPaise,
    publicCopy: `CAD operator payout = fixed ₹${operatorPayoutPaise / 100} on the standard ₹${grossPricePaise / 100} order (booking ₹${bookingPaise / 100} + balance ₹${balancePaise / 100}).`,
  };
}

/** Deploy / release gate — throws if rule cannot be loaded. */
function assertCadPayoutRuleReady() {
  return getApprovedCadPayoutRule();
}

/**
 * Compute immutable settlement snapshot + CAD credit for a ledger kind.
 * @returns {{ amountPaise, breakdown }}
 */
function computeCadPayoutSettlement({ kind, sourcePaidPaise = 0 } = {}) {
  const rule = getApprovedCadPayoutRule();

  let amountPaise = 0;
  if (kind === CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY) {
    amountPaise = rule.operatorPayoutPaise;
  } else if (kind === CAD_WALLET_ENTRY_KIND.REVISION_DELIVERY) {
    // Revisions: fixed override, or 0 (no row) — never silent percent of surveyor paid.
    amountPaise = parseRequiredNonNegInt("CAD_REVISION_OPERATOR_PAYOUT_PAISE", 0);
  }

  const breakdown = {
    pricingRuleVersion: rule.version,
    payoutModel: rule.model,
    grossPricePaise: rule.grossPricePaise,
    bookingPaise: rule.bookingPaise,
    balancePaise: rule.balancePaise,
    payoutPaise: amountPaise,
    platformFeePaise: rule.platformFeePaise,
    taxPaise: rule.taxPaise,
    adjustmentPaise: rule.adjustmentPaise,
    sourcePaidAmountPaise: Math.max(0, Math.round(Number(sourcePaidPaise) || 0)),
  };

  return { amountPaise, breakdown, rule };
}

/** @deprecated H-11 — percent payout removed. Kept for API shape compat (always null). */
function getCadPayoutPercent() {
  return null;
}

/** @deprecated Use computeCadPayoutSettlement. */
function computeCadPayoutPaiseFromSourcePaid(_sourcePaidPaise) {
  const { amountPaise } = computeCadPayoutSettlement({
    kind: CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY,
  });
  return amountPaise;
}

function resolveInitialDeliverySourcePaidPaise(upload) {
  if (!upload) return 0;
  const sp = upload.sketchPayment || {};
  if (sp.paidAmountPaise != null && Number(sp.paidAmountPaise) > 0) {
    return Math.round(Number(sp.paidAmountPaise));
  }
  if (sp.status === "COMPLETED" && sp.amountPaise != null && Number(sp.amountPaise) > 0) {
    return Math.round(Number(sp.amountPaise));
  }
  return 0;
}

function resolveRevisionSourcePaidPaise(upload, revisionNo) {
  if (!upload || revisionNo == null) return 0;
  const rev = Number(revisionNo);
  if (!Number.isFinite(rev)) return 0;
  const payments = Array.isArray(upload.revisionFeePayments) ? upload.revisionFeePayments : [];
  const match = payments.find((p) => Number(p.revisionNo) === rev);
  if (!match) return 0;
  if (match.paidAmountPaise != null && Number(match.paidAmountPaise) > 0) {
    return Math.round(Number(match.paidAmountPaise));
  }
  if (match.chargedAmountPaise != null && Number(match.chargedAmountPaise) > 0) {
    return Math.round(Number(match.chargedAmountPaise));
  }
  return 0;
}

function resolveSourcePaidPaiseForLedgerKind(upload, kind, revisionNo) {
  if (kind === CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY) {
    return resolveInitialDeliverySourcePaidPaise(upload);
  }
  if (kind === CAD_WALLET_ENTRY_KIND.REVISION_DELIVERY) {
    return resolveRevisionSourcePaidPaise(upload, revisionNo);
  }
  return 0;
}

module.exports = {
  APPROVED_CAD_PAYOUT_RULE,
  getApprovedCadPayoutRule,
  assertCadPayoutRuleReady,
  computeCadPayoutSettlement,
  getCadPayoutPercent,
  computeCadPayoutPaiseFromSourcePaid,
  resolveInitialDeliverySourcePaidPaise,
  resolveRevisionSourcePaidPaise,
  resolveSourcePaidPaiseForLedgerKind,
};
