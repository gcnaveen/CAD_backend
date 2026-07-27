/**
 * Ops observability snapshot for admin dashboards (M-07).
 * Order funnel, payment reconciliation flags, SLA aging, CAD capacity.
 */

const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const User = require("../models/user/User");
const PaymentAttempt = require("../models/payment/PaymentAttempt");
const AdminAuditEvent = require("../models/security/AdminAuditEvent");
const FileAccessEvent = require("../models/security/FileAccessEvent");
const {
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
  USER_ROLES,
} = require("../config/constants");
const { RECON_FLAG } = require("../models/payment/PaymentAttempt");
const paymentReconciliation = require("./paymentReconciliation.service");

function getDeliverySlaMs() {
  const n = Number(process.env.CAD_DELIVERY_SLA_MS || 48 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 48 * 60 * 60 * 1000;
}

async function getOrderFunnel() {
  const statuses = Object.values(SURVEY_SKETCH_STATUS);
  const rows = await SurveyorSketchUpload.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const byStatus = {};
  for (const s of statuses) byStatus[s] = 0;
  for (const r of rows) {
    if (r._id) byStatus[r._id] = r.count;
  }
  const total = rows.reduce((s, r) => s + r.count, 0);
  return { total, byStatus };
}

async function getSlaAging() {
  const slaDue = require("./slaDue.service");
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

  const aging = {
    withinSla: 0,
    warning: 0,
    escalated: 0,
    breached: 0,
    paused: 0,
    items: [],
    slaHours: Math.round(slaMs / 3600000),
    openCount: open.length,
    sortedByRisk: true,
  };

  const decorated = [];
  for (const a of open) {
    const snap = slaDue.buildSlaSnapshot(a);
    decorated.push({ assignment: a, snap });
    if (snap.state === slaDue.SLA_STATE.BREACHED) aging.breached += 1;
    else if (snap.state === slaDue.SLA_STATE.ESCALATED) aging.escalated += 1;
    else if (snap.state === slaDue.SLA_STATE.WARNING) aging.warning += 1;
    else if (snap.state === slaDue.SLA_STATE.PAUSED) aging.paused += 1;
    else aging.withinSla += 1;
  }

  decorated.sort((x, y) => x.snap.riskRank - y.snap.riskRank);
  aging.items = decorated.slice(0, 50).map(({ assignment: a, snap }) => ({
    assignmentId: String(a._id),
    status: a.status,
    assignedAt: a.assignedAt,
    dueAt: snap.dueAt,
    state: snap.state,
    remainingHours: snap.remainingHours,
    ageHours: snap.ageHours,
    cadUserId: a.assignedTo ? String(a.assignedTo) : null,
    uploadId: a.surveyorSketchUpload ? String(a.surveyorSketchUpload) : null,
  }));

  return aging;
}

async function getOperatorCapacity() {
  const cads = await User.find({ role: USER_ROLES.CAD, deletedAt: null })
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
