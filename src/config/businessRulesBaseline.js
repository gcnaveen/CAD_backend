/**
 * Single approved business-rules baseline (audit H-08 + M-08).
 * Public marketing and FE copy must match these constants — not invent tiers/metrics.
 * Lifecycle + QC come from lifecycleQcSpec.js (canonical signed machine).
 */

const {
  QC_CHECKLIST_11E,
  QC_MATRIX,
  ORDER_LIFECYCLE_MILESTONES,
  getLifecycleQcPublicSpec,
  LIFECYCLE_QC_SPEC,
} = require("./lifecycleQcSpec");

/** Surveyor post-delivery balance to unlock CAD download — fixed, no tiers. */
const SURVEYOR_BALANCE_FEE_RUPEES_FIXED = 400;
const SURVEYOR_BALANCE_FEE_PAISE_FIXED = 40000;

const QC_CHECKLIST_ID = QC_MATRIX.checklistId;
const QC_CHECKLIST_VERSION = QC_MATRIX.version;
const ORDER_LIFECYCLE = ORDER_LIFECYCLE_MILESTONES;

/**
 * Public-safe baseline payload for APIs / FE.
 * Does not include government-approval claims.
 */
function getApprovedBusinessRulesPublic() {
  const cadInterestEnabled =
    String(process.env.CAD_INTEREST_ENABLED || "true").toLowerCase() !== "false";

  // H-11: fixed ₹400 CAD payout on standard ₹500 order (not percent).
  let cadPayout;
  try {
    const { getApprovedCadPayoutRule } = require("../services/cadPayoutPricing.service");
    cadPayout = getApprovedCadPayoutRule();
  } catch (_) {
    cadPayout = null;
  }

  const lifecycleQc = getLifecycleQcPublicSpec();

  return {
    baselineId: "NORTHCOT-BUSINESS-RULES-H08",
    reviewDate: "2026-07-25",
    lifecycleQcSpecId: LIFECYCLE_QC_SPEC.specId,
    lifecycleQcVersion: LIFECYCLE_QC_SPEC.version,
    surveyorBalanceFee: {
      model: "FIXED",
      rupees: SURVEYOR_BALANCE_FEE_RUPEES_FIXED,
      paise: SURVEYOR_BALANCE_FEE_PAISE_FIXED,
      tiers: false,
      publicCopy: "Fixed ₹400 balance after CAD delivery (no tiers).",
    },
    cadOperatorEarnings: {
      model: "FIXED",
      tiers: false,
      ruleVersion: cadPayout?.version || null,
      standardOrderGrossRupees: cadPayout ? cadPayout.grossPricePaise / 100 : 500,
      bookingRupees: cadPayout ? cadPayout.bookingPaise / 100 : 100,
      balanceRupees: cadPayout ? cadPayout.balancePaise / 100 : 400,
      payoutRupees: cadPayout ? cadPayout.operatorPayoutPaise / 100 : 400,
      payoutPaise: cadPayout?.operatorPayoutPaise ?? 40000,
      percent: null,
      publicCopy:
        cadPayout?.publicCopy ||
        "CAD operator payout = fixed ₹400 on the standard ₹500 order (booking ₹100 + balance ₹400).",
      prohibitedCopy: [
        "up to ₹400 depending on tier",
        "tier-based payout",
        "20% of surveyor payment",
        "CAD earns ₹100 on a ₹500 order",
      ],
    },
    qc: {
      checklistId: QC_MATRIX.checklistId,
      version: QC_MATRIX.version,
      product: "11E",
      checkCount: QC_CHECKLIST_11E.length,
      checks: QC_CHECKLIST_11E,
      byOrderType: QC_MATRIX.byOrderType,
      siteCopyApproved: QC_MATRIX.siteCopyApproved,
      prohibitedCopy: QC_MATRIX.prohibitedCopy,
      expressBypassQc: false,
    },
    lifecycle: ORDER_LIFECYCLE_MILESTONES,
    lifecycleMachine: {
      sketchStatuses: lifecycleQc.sketchStatuses,
      assignmentStatuses: lifecycleQc.assignmentStatuses,
      sketchTransitions: lifecycleQc.sketchTransitions,
      legacySketchStatusMap: lifecycleQc.legacySketchStatusMap,
      labels: lifecycleQc.labels,
      notificationTriggers: lifecycleQc.notificationTriggers,
      analyticsKeys: lifecycleQc.analyticsKeys,
    },
    governmentClaims: {
      allowed: false,
      prohibitedCopy: [
        "Government Approved",
        "Government accepted",
        "Official government partner",
      ],
      note: "Do not publish until documentary basis is filed with Founder.",
    },
    testimonials: {
      fictionalAllowed: false,
      rule: "Only consented, verifiable reviews with name + date + proof on file.",
    },
    metrics: {
      rule: "Publish only metrics with analytics proof and owner + review date in content matrix.",
    },
    cadOperatorRegistration: {
      live: cadInterestEnabled,
      publicCopyWhenClosed: "CAD operator registration — Coming Soon",
      envFlag: "CAD_INTEREST_ENABLED",
    },
  };
}

module.exports = {
  SURVEYOR_BALANCE_FEE_RUPEES_FIXED,
  SURVEYOR_BALANCE_FEE_PAISE_FIXED,
  QC_CHECKLIST_11E,
  QC_CHECKLIST_ID,
  QC_CHECKLIST_VERSION,
  ORDER_LIFECYCLE,
  getApprovedBusinessRulesPublic,
};
