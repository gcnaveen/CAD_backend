/**
 * Ops observability snapshot for admin dashboards (M-07).
 * Order funnel, payment reconciliation flags, SLA aging, CAD capacity.
 */

const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const User = require("../models/user/User");
const PaymentAttempt = require("../models/payment/PaymentAttempt");
const AdminAuditEvent = require("../models/security/AdminAuditEvent");
const FileAccessEvent = require("../models/security/FileAccessEvent");
const {
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
  USER_ROLES,
} = require("../config/constants");
const { RECON_FLAG } = require("../models/payment/PaymentAttempt");
const paymentReconciliation = require("./paymentReconciliation.service");
const { mongoRoleEquals } = require("../utils/roleNormalize");
const orderStatusCounts = require("./orderStatusCounts.service");
const slaDue = require("./slaDue.service");

function getDeliverySlaMs() {
  const n = Number(process.env.CAD_DELIVERY_SLA_MS || 48 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 48 * 60 * 60 * 1000;
}

/** Same source as admin dashboard order counts (COUNT-01). */
async function getOrderFunnel() {
  return orderStatusCounts.getOrderStatusCounts();
}

async function getSlaAging() {
  const slaMs = getDeliverySlaMs();
  const openStatuses = [
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
  ];
  const open = await SurveySketchAssignment.find({
    status: { $in: openStatuses },
  })
    .select(
      "status assignedAt dueAt slaDurationMs slaPausedTotalMs slaPausedAt slaExtensions slaState assignedTo surveyorSketchUpload"
    )
    .lean();

  const summary = slaDue.computeSlaAgingSummary(open, { itemLimit: 50 });
  return {
    withinSla: summary.withinSla,
    warning: summary.warning,
    escalated: summary.escalated,
    breached: summary.breached,
    paused: summary.paused,
    items: summary.items,
    slaHours: Math.round(slaMs / 3600000),
    openCount: summary.openCount,
    sortedByRisk: true,
  };
}

async function getOperatorCapacity() {
  const cads = await User.find({ ...mongoRoleEquals(USER_ROLES.CAD), deletedAt: null })
    .select("status cadProfile.availabilityStatus")
    .lean();
  const capacity = {
    totalCadUsers: cads.length,
    active: 0,
    available: 0,
    busy: 0,
    offline: 0,
    unknown: 0,
  };
  for (const u of cads) {
    if (u.status === "ACTIVE") capacity.active += 1;
    const avail = String(u.cadProfile?.availabilityStatus || "").toUpperCase();
    if (avail === "AVAILABLE") capacity.available += 1;
    else if (avail === "BUSY") capacity.busy += 1;
    else if (avail === "OFFLINE") capacity.offline += 1;
    else capacity.unknown += 1;
  }
  return capacity;
}

async function getPaymentReconSnapshot() {
  const summary = await paymentReconciliation.runDailyReconciliation({ persist: false });
  const openFlags = Object.values(summary.flags || {}).reduce((s, n) => s + Number(n || 0), 0);
  return {
    window: { from: summary.from, to: summary.to },
    totalAttempts: summary.totalAttempts,
    flags: summary.flags,
    openFlagCount: openFlags,
    sampleItems: (summary.items || []).slice(0, 20),
  };
}

async function getRecentPaymentMismatches(limit = 20) {
  const rows = await PaymentAttempt.find({
    "reconciliationFlags.flag": {
      $in: [RECON_FLAG.MISMATCHED, RECON_FLAG.MISSING, RECON_FLAG.DUPLICATED],
    },
  })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select(
      "merchantOrderId providerState expectedAmountPaise paidAmountPaise reconciliationFlags purpose"
    )
    .lean();
  return rows;
}

async function getAuditActivityCounts(hours = 24) {
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const [adminActions, fileAccess] = await Promise.all([
    AdminAuditEvent.countDocuments({ createdAt: { $gte: since } }),
    FileAccessEvent.countDocuments({ createdAt: { $gte: since } }),
  ]);
  return { windowHours: hours, adminActions, fileAccess };
}

/**
 * Full ops snapshot for GET /api/admin/ops/observability
 */
async function getObservabilitySnapshot() {
  const [funnel, sla, capacity, payments, mismatches, auditActivity] = await Promise.all([
    getOrderFunnel(),
    getSlaAging(),
    getOperatorCapacity(),
    getPaymentReconSnapshot(),
    getRecentPaymentMismatches(15),
    getAuditActivityCounts(24),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    correlationRequiredHeader: "X-Correlation-Id",
    funnel,
    sla,
    operatorCapacity: capacity,
    payments,
    recentPaymentMismatches: mismatches,
    auditActivity,
    alerts: {
      slaBreach: sla.breached > 0,
      slaEscalated: sla.escalated > 0,
      slaWarning: sla.warning > 0,
      paymentFlags: payments.openFlagCount > 0,
      noAvailableCad: capacity.available === 0 && capacity.active > 0,
    },
  };
}

module.exports = {
  getDeliverySlaMs,
  getOrderFunnel,
  getSlaAging,
  getOperatorCapacity,
  getPaymentReconSnapshot,
  getObservabilitySnapshot,
};
