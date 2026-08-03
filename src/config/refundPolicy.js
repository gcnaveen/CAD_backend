/**
 * Approved refund policy — single source of truth (unifies Terms vs ops tooling).
 *
 * Conflict fixed:
 *   Marketing / UI sometimes promised refunds while Terms said “no refunds”.
 *   Ops also has Admin balance-refund (C-02 entitlement revoke) which is NOT a
 *   customer entitlement — it records an exceptional gateway/ops refund after the fact.
 *
 * Approved stance (founder/finance):
 *   - Customer-facing: fees are **non-refundable** once paid (booking, balance, revision, superimpose).
 *   - Exceptions: ops-only, after founder/finance approval (duplicate charge, gateway error, etc.).
 *   - Never advertise money-back / satisfaction guarantees.
 */

const { BadRequestError } = require("../utils/errors");

/** Immutable approved baseline — bump `version` when finance changes policy. */
const APPROVED_REFUND_POLICY = Object.freeze({
  version: "REFUND_POLICY_V1",
  baselineId: "NORTHCOT-REFUND-POLICY",
  reviewDate: "2026-07-30",
  approvedBy: "founder/finance",
  phaseRefs: Object.freeze(["BIZ-REFUND", "H-08"]),

  /** Customer has no contractual right to a refund after successful payment. */
  customerRefundEntitled: false,

  /** Self-service / in-app refund request APIs are not offered. */
  selfServiceRefundEnabled: false,

  /**
   * Admin may mark REFUNDED only after an exceptional off-platform refund
   * (revokes CAD download entitlement). Not a public promise.
   */
  exceptionalAdminRefundEnabled: true,

  /** Allowed reason codes for Admin POST …/balance-refund */
  exceptionalReasonCodes: Object.freeze([
    "DUPLICATE_CHARGE",
    "GATEWAY_ERROR",
    "AMOUNT_MISMATCH_REVERSAL",
    "FOUNDER_GOODWILL",
    "CHARGEBACK_OR_DISPUTE",
    "OTHER_OPS",
  ]),

  termsCopyApproved:
    "All fees paid for NorthCot sketch / CAD services (booking, balance, revision, and add-ons) are non-refundable once payment is successfully completed, except where required by applicable law or where NorthCot elects, at its sole discretion, to issue an exceptional refund for a documented payment error (for example duplicate charge or gateway failure). Exceptional refunds are not a customer right and are not advertised as a guarantee.",

  publicCopyShort: "Fees are non-refundable once paid. Exceptional payment-error refunds may be issued at NorthCot’s discretion.",

  prohibitedCopy: Object.freeze([
    "money-back guarantee",
    "100% refund",
    "full refund if not satisfied",
    "satisfaction guaranteed or your money back",
    "request a refund anytime",
    "easy refunds",
    "refund promise",
  ]),

  adminOpsNote:
    "POST /api/admin/sketch-uploads/{uploadId}/balance-refund records an already-approved exceptional refund and revokes download entitlement. It does not create a customer refund entitlement.",
});

function getApprovedRefundPolicy() {
  return {
    version: APPROVED_REFUND_POLICY.version,
    baselineId: APPROVED_REFUND_POLICY.baselineId,
    reviewDate: APPROVED_REFUND_POLICY.reviewDate,
    approvedBy: APPROVED_REFUND_POLICY.approvedBy,
    phaseRefs: [...APPROVED_REFUND_POLICY.phaseRefs],
    customerRefundEntitled: APPROVED_REFUND_POLICY.customerRefundEntitled,
    selfServiceRefundEnabled: APPROVED_REFUND_POLICY.selfServiceRefundEnabled,
    exceptionalAdminRefundEnabled: APPROVED_REFUND_POLICY.exceptionalAdminRefundEnabled,
    exceptionalReasonCodes: [...APPROVED_REFUND_POLICY.exceptionalReasonCodes],
    termsCopyApproved: APPROVED_REFUND_POLICY.termsCopyApproved,
    publicCopyShort: APPROVED_REFUND_POLICY.publicCopyShort,
    prohibitedCopy: [...APPROVED_REFUND_POLICY.prohibitedCopy],
    adminOpsNote: APPROVED_REFUND_POLICY.adminOpsNote,
  };
}

function getRefundPolicyPublic() {
  const p = getApprovedRefundPolicy();
  return {
    version: p.version,
    baselineId: p.baselineId,
    reviewDate: p.reviewDate,
    customerRefundEntitled: p.customerRefundEntitled,
    selfServiceRefundEnabled: p.selfServiceRefundEnabled,
    termsCopyApproved: p.termsCopyApproved,
    publicCopyShort: p.publicCopyShort,
    prohibitedCopy: p.prohibitedCopy,
  };
}

/**
 * Validate Admin exceptional refund payload against approved policy.
 * @returns {{ reasonCode: string, note: string, policyVersion: string }}
 */
function assertExceptionalAdminRefundAllowed({ reasonCode, reason, note } = {}) {
  const policy = getApprovedRefundPolicy();
  if (!policy.exceptionalAdminRefundEnabled) {
    throw new BadRequestError("Exceptional admin refunds are disabled by policy", {
      code: "REFUND_POLICY_ADMIN_DISABLED",
    });
  }

  const code = String(reasonCode || "")
    .trim()
    .toUpperCase();
  if (!code || !policy.exceptionalReasonCodes.includes(code)) {
    throw new BadRequestError(
      `reasonCode required and must be one of: ${policy.exceptionalReasonCodes.join(", ")}`,
      {
        code: "REFUND_REASON_CODE_REQUIRED",
        errors: [{ field: "reasonCode", allowed: policy.exceptionalReasonCodes }],
      }
    );
  }

  const text = String(note || reason || "")
    .trim()
    .slice(0, 500);
  if (!text) {
    throw new BadRequestError("note (or reason) is required for exceptional refund audit trail", {
      code: "REFUND_NOTE_REQUIRED",
      errors: [{ field: "note", message: "Required" }],
    });
  }

  return {
    reasonCode: code,
    note: text,
    policyVersion: policy.version,
  };
}

module.exports = {
  APPROVED_REFUND_POLICY,
  getApprovedRefundPolicy,
  getRefundPolicyPublic,
  assertExceptionalAdminRefundAllowed,
};
