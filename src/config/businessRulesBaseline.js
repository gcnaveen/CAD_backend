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

/** Surveyor post-delivery balance — from approved sketch contract (BIZ-09). */
function getSurveyorBalanceFeeFixed() {
  try {
    const { getApprovedSketchOrderPricing } = require("./sketchOrderPricing");
    const rule = getApprovedSketchOrderPricing();
    return { rupees: rule.balanceRupees, paise: rule.balancePaise };
  } catch (_) {
    return { rupees: 400, paise: 40000 };
  }
}

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

  let sketchPricing;
  try {
    const { getApprovedSketchOrderPricing } = require("./sketchOrderPricing");
    sketchPricing = getApprovedSketchOrderPricing();
  } catch (_) {
    sketchPricing = null;
  }

  const balanceFixed = getSurveyorBalanceFeeFixed();
  const lifecycleQc = getLifecycleQcPublicSpec();

  return {
    baselineId: "NORTHCOT-BUSINESS-RULES-H08",
    reviewDate: "2026-07-25",
    lifecycleQcSpecId: LIFECYCLE_QC_SPEC.specId,
    lifecycleQcVersion: LIFECYCLE_QC_SPEC.version,
    surveyorBalanceFee: {
      model: "FIXED",
      rupees: balanceFixed.rupees,
      paise: balanceFixed.paise,
      tiers: false,
      publicCopy: `Fixed ₹${balanceFixed.rupees} balance after CAD delivery (no tiers).`,
    },
    /** BIZ-09: same contract as checkout — do not hard-code ₹500 on FE. */
    sketchOrderPricing: sketchPricing
      ? {
          version: sketchPricing.version,
          baselineId: sketchPricing.baselineId,
          grossRupees: sketchPricing.grossRupees,
          bookingRupees: sketchPricing.bookingRupees,
          balanceRupees: sketchPricing.balanceRupees,
          revisionRupees: sketchPricing.revisionRupees,
          superimposeRupees: sketchPricing.superimposeRupees,
          publicCopy: sketchPricing.publicCopy,
          phaseRefs: sketchPricing.phaseRefs,
        }
      : null,
    cadOperatorEarnings: {
      model: "FIXED",
      tiers: false,
      ruleVersion: cadPayout?.version || null,
      standardOrderGrossRupees: cadPayout ? cadPayout.grossPricePaise / 100 : sketchPricing?.grossRupees ?? 500,
      bookingRupees: cadPayout ? cadPayout.bookingPaise / 100 : sketchPricing?.bookingRupees ?? 100,
      balanceRupees: cadPayout ? cadPayout.balancePaise / 100 : sketchPricing?.balanceRupees ?? 400,
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
    /** Unified refund policy — Terms + marketing + Admin ops must match (LEGAL-01). */
    refundPolicy: require("./refundPolicy").getRefundPolicyPublic(),
    /**
     * PRICE-02: homepage revision fee. 0 = do not advertise a paid revision
     * (complimentary revision #1; #2+ unpaid unless SKETCH_REVISION_FEE_PAISE or admin plan > 0).
     */
    revisionPaise: sketchPricing ? sketchPricing.revisionPaise : 0,
    revisionRupees: sketchPricing ? sketchPricing.revisionRupees : 0,
    pricing: {
      revision: {
        payableRupees: sketchPricing ? sketchPricing.revisionRupees : 0,
        paise: sketchPricing ? sketchPricing.revisionPaise : 0,
      },
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
    /**
     * SUPPORT-01: customer support links for FE (WhatsApp / email).
     * Configure via SUPPORT_WHATSAPP_URL (preferred) or SUPPORT_WHATSAPP_NUMBER (+E.164 digits).
     */
    supportContact: (() => {
      const whatsappUrlRaw = String(process.env.SUPPORT_WHATSAPP_URL || "").trim();
      const whatsappNumber = String(process.env.SUPPORT_WHATSAPP_NUMBER || "").trim().replace(/\s+/g, "");
      const email = String(process.env.SUPPORT_EMAIL || "").trim() || null;
      let whatsappUrl = whatsappUrlRaw || null;
      if (!whatsappUrl && whatsappNumber) {
        const digits = whatsappNumber.replace(/[^\d]/g, "");
        if (digits) whatsappUrl = `https://wa.me/${digits}`;
      }
      return {
        whatsappUrl,
        whatsappNumber: whatsappNumber || null,
        email,
        configured: Boolean(whatsappUrl || email),
      };
    })(),
  };
}

const { APPROVED_SKETCH_ORDER_PRICING } = require("./sketchOrderPricing");
/** @deprecated Prefer getApprovedSketchOrderPricing() — kept for H-08 acceptance. */
const SURVEYOR_BALANCE_FEE_RUPEES_FIXED = APPROVED_SKETCH_ORDER_PRICING.balancePaise / 100;
const SURVEYOR_BALANCE_FEE_PAISE_FIXED = APPROVED_SKETCH_ORDER_PRICING.balancePaise;

module.exports = {
  SURVEYOR_BALANCE_FEE_RUPEES_FIXED,
  SURVEYOR_BALANCE_FEE_PAISE_FIXED,
  QC_CHECKLIST_11E,
  QC_CHECKLIST_ID,
  QC_CHECKLIST_VERSION,
  ORDER_LIFECYCLE,
  getApprovedBusinessRulesPublic,
};
