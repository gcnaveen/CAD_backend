/**
 * CAD wallet: pending / paid payouts for completed deliveries.
 * Amounts come from env (paise). Zero = no ledger row created.
 */

const mongoose = require("mongoose");
const CadWalletLedger = require("../models/cad/CadWalletLedger");
const User = require("../models/user/User");
const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const {
  CAD_WALLET_ENTRY_STATUS,
  CAD_WALLET_ENTRY_KIND,
  USER_ROLES,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
} = require("../config/constants");
const cadPayoutPricing = require("./cadPayoutPricing.service");
const { NotFoundError, BadRequestError } = require("../utils/errors");
const logger = require("../utils/logger");

function parseNonNegativeIntEnv(name, defaultValue = 0) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return defaultValue;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : defaultValue;
}

function getInitialDeliveryPayoutPaise() {
  return parseNonNegativeIntEnv("CAD_INITIAL_DELIVERY_PAYOUT_PAISE", 0);
}

function getRevisionDeliveryPayoutPaise() {
  return parseNonNegativeIntEnv("CAD_REVISION_DELIVERY_PAYOUT_PAISE", 0);
}

function formatLedgerEntryRow(row) {
  const paid = effectivePaidPaise(row);
  const total = Math.max(0, Number(row.amountPaise) || 0);
  const remaining = Math.max(0, total - paid);
  let balanceStatus = "PENDING";
  if (total <= 0 || remaining <= 0) balanceStatus = "PAID";
  else if (paid > 0) balanceStatus = "PARTIAL";
  const sourcePaid = Math.max(0, Number(row.sourcePaidAmountPaise) || 0);
  return {
    ledgerId: row._id,
    kind: row.kind,
    revisionNo: row.revisionNo,
    sourcePaidAmountPaise: sourcePaid,
    sourcePaidRupees: paiseToRupees(sourcePaid),
    pricingRuleVersion: row.pricingRuleVersion || null,
    payoutModel: row.payoutModel || (row.payoutPercent != null ? "PERCENT" : "FIXED"),
    payoutPercent: row.payoutPercent != null ? Number(row.payoutPercent) : null,
    grossPricePaise: row.grossPricePaise != null ? Number(row.grossPricePaise) : null,
    bookingPaise: row.bookingPaise != null ? Number(row.bookingPaise) : null,
    balancePaise: row.balancePaise != null ? Number(row.balancePaise) : null,
    payoutPaise: row.payoutPaise != null ? Number(row.payoutPaise) : total,
    platformFeePaise: row.platformFeePaise != null ? Number(row.platformFeePaise) : null,
    taxPaise: row.taxPaise != null ? Number(row.taxPaise) : null,
    adjustmentPaise: row.adjustmentPaise != null ? Number(row.adjustmentPaise) : null,
    amountPaise: total,
    amountRupees: paiseToRupees(total),
    paidAmountPaise: paid,
    paidAmountRupees: paiseToRupees(paid),
    remainingPaise: remaining,
    remainingRupees: paiseToRupees(remaining),
    paidPercent: paidPercentForDoc(row),
    balanceStatus,
    status: row.status,
    paidAt: row.paidAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function paiseToRupees(paise) {
  return Math.round(Number(paise) || 0) / 100;
}

function formatWalletSummary(totalEarningsPaise, receivedPaymentPaise, pendingPaymentPaise) {
  const total = Math.max(0, Number(totalEarningsPaise) || 0);
  const received = Math.max(0, Math.min(total, Number(receivedPaymentPaise) || 0));
  const pending = Math.max(0, Number(pendingPaymentPaise) ?? total - received);
  return {
    totalEarningsPaise: total,
    pendingPaymentPaise: pending,
    receivedPaymentPaise: received,
    totalEarningsRupees: paiseToRupees(total),
    pendingPaymentRupees: paiseToRupees(pending),
    receivedPaymentRupees: paiseToRupees(received),
    totalEarnings: paiseToRupees(total),
    pendingPayment: paiseToRupees(pending),
    receivedPayment: paiseToRupees(received),
    /** Plural aliases for dashboard cards */
    pendingPayments: paiseToRupees(pending),
    receivedPayments: paiseToRupees(received),
  };
}

/** Amount already paid toward this entry (handles legacy PAID rows without paidAmountPaise). */
function effectivePaidPaise(doc) {
  const total = Math.max(0, Number(doc.amountPaise) || 0);
  const recorded = doc.paidAmountPaise != null ? Number(doc.paidAmountPaise) : null;
  if (doc.status === CAD_WALLET_ENTRY_STATUS.PAID) {
    if (recorded != null && recorded > 0) return Math.min(total, recorded);
    return total;
  }
  return Math.min(total, Math.max(0, recorded || 0));
}

function paidPercentForDoc(doc) {
  const total = Math.max(0, Number(doc.amountPaise) || 0);
  if (total <= 0) return 100;
  const paid = effectivePaidPaise(doc);
  return Math.min(100, Math.round((paid / total) * 100));
}

/**
 * Record a pending earning from the versioned FIXED payout rule (H-11).
 * Idempotent per (assignment, kind, revisionNo).
 */
async function recordPendingEarningIfConfigured({
  cadUserId,
  assignmentId,
  surveyorSketchUploadId,
  kind,
  revisionNo,
}) {
  const upload = surveyorSketchUploadId
    ? await SurveyorSketchUpload.findById(surveyorSketchUploadId)
        .select("sketchPayment revisionFeePayments")
        .lean()
    : null;

  const sourcePaidAmountPaise = cadPayoutPricing.resolveSourcePaidPaiseForLedgerKind(
    upload,
    kind,
    revisionNo
  );
  const { amountPaise, breakdown } = cadPayoutPricing.computeCadPayoutSettlement({
    kind,
    sourcePaidAmountPaise,
  });
  if (!amountPaise || amountPaise <= 0) return null;

  const rev =
    kind === CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY
      ? 0
      : revisionNo != null && Number.isFinite(Number(revisionNo))
        ? Number(revisionNo)
        : 0;

  try {
    await CadWalletLedger.updateOne(
      { assignment: assignmentId, kind, revisionNo: rev },
      {
        $setOnInsert: {
          cadUser: cadUserId,
          assignment: assignmentId,
          surveyorSketchUpload: surveyorSketchUploadId || null,
          kind,
          revisionNo: rev,
          amountPaise,
          sourcePaidAmountPaise,
          payoutPercent: null,
          pricingRuleVersion: breakdown.pricingRuleVersion,
          payoutModel: breakdown.payoutModel,
          grossPricePaise: breakdown.grossPricePaise,
          bookingPaise: breakdown.bookingPaise,
          balancePaise: breakdown.balancePaise,
          payoutPaise: breakdown.payoutPaise,
          platformFeePaise: breakdown.platformFeePaise,
          taxPaise: breakdown.taxPaise,
          adjustmentPaise: breakdown.adjustmentPaise,
          paidAmountPaise: 0,
          paymentLog: [],
          status: CAD_WALLET_ENTRY_STATUS.PENDING,
        },
      },
      { upsert: true }
    );
  } catch (err) {
    if (err && err.code === 11000) {
      return null;
    }
    logger.error("cadWallet.recordPendingEarning failed", err, {
      assignmentId: String(assignmentId),
      kind,
      revisionNo: rev,
    });
    throw err;
  }
  return true;
}

async function getSummaryForCad(cadUserId) {
  const uid =
    cadUserId instanceof mongoose.Types.ObjectId
      ? cadUserId
      : new mongoose.Types.ObjectId(String(cadUserId));
  const paidStr = CAD_WALLET_ENTRY_STATUS.PAID;
  const [agg] = await CadWalletLedger.aggregate([
    { $match: { cadUser: uid } },
    {
      $addFields: {
        _paidRaw: { $ifNull: ["$paidAmountPaise", 0] },
      },
    },
    {
      $addFields: {
        effectivePaidPaise: {
          $min: [
            "$amountPaise",
            {
              $cond: [
                { $eq: ["$status", paidStr] },
                {
                  $cond: [{ $gt: ["$_paidRaw", 0] }, "$_paidRaw", "$amountPaise"],
                },
                { $max: [0, "$_paidRaw"] },
              ],
            },
          ],
        },
      },
    },
    {
      $group: {
        _id: null,
        totalEarningsPaise: { $sum: "$amountPaise" },
        receivedPaymentPaise: { $sum: "$effectivePaidPaise" },
      },
    },
    {
      $project: {
        _id: 0,
        totalEarningsPaise: 1,
        receivedPaymentPaise: {
          $min: ["$totalEarningsPaise", "$receivedPaymentPaise"],
        },
      },
    },
    {
      $project: {
        totalEarningsPaise: 1,
        receivedPaymentPaise: 1,
        pendingPaymentPaise: {
          $max: [0, { $subtract: ["$totalEarningsPaise", "$receivedPaymentPaise"] }],
        },
      },
    },
  ]);

  const totalEarningsPaise = Math.max(0, agg?.totalEarningsPaise ?? 0);
  const receivedPaymentPaise = Math.max(0, Math.min(totalEarningsPaise, agg?.receivedPaymentPaise ?? 0));
  const pendingPaymentPaise = Math.max(0, totalEarningsPaise - receivedPaymentPaise);

  return formatWalletSummary(totalEarningsPaise, receivedPaymentPaise, pendingPaymentPaise);
}

async function listTransactionsForCad(cadUserId, options = {}) {
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const skip = (page - 1) * limit;

  const filter = { cadUser: cadUserId };

  const [data, total] = await Promise.all([
    CadWalletLedger.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("assignment", "status completedAt surveyorSketchUpload")
      .populate("surveyorSketchUpload", "applicationId surveyNo status")
      .lean(),
    CadWalletLedger.countDocuments(filter),
  ]);

  const rows = data.map((row) => ({
    _id: row._id,
    ...formatLedgerEntryRow(row),
    paymentLog: row.paymentLog || [],
    assignment: row.assignment,
    surveyorSketchUpload: row.surveyorSketchUpload,
  }));

  return { data: rows, total, page, limit };
}

async function recordPayment(entryId, actor, { payFull, amountPaise: tranchePaise }) {
  const doc = await CadWalletLedger.findById(entryId);
  if (!doc) {
    throw new NotFoundError("Wallet entry not found", { code: "CAD_WALLET_ENTRY_NOT_FOUND" });
  }

  const total = Math.max(0, Number(doc.amountPaise) || 0);
  const currentPaid = effectivePaidPaise(doc);
  const remaining = Math.max(0, total - currentPaid);

  if (remaining <= 0) {
    return formatLedgerEntryForAdmin(
      await CadWalletLedger.findById(entryId)
        .populate("cadUser", "name auth")
        .populate("assignment", "status")
        .populate("surveyorSketchUpload", "applicationId surveyNo")
        .lean()
    );
  }

  let delta = 0;
  if (payFull) {
    delta = remaining;
  } else {
    const n = Number(tranchePaise);
    if (!Number.isFinite(n) || n <= 0) {
      throw new BadRequestError("amountPaise must be a positive integer", {
        code: "INVALID_PAYMENT_AMOUNT",
      });
    }
    delta = Math.min(Math.floor(n), remaining);
  }

  if (delta <= 0) {
    throw new BadRequestError("No payment amount to apply", { code: "ZERO_PAYMENT" });
  }

  const newPaid = currentPaid + delta;
  doc.paidAmountPaise = Math.min(total, newPaid);
  if (!Array.isArray(doc.paymentLog)) doc.paymentLog = [];
  doc.paymentLog.push({
    amountPaise: delta,
    recordedAt: new Date(),
    recordedBy: actor?._id || null,
  });

  if (doc.paidAmountPaise >= total) {
    doc.status = CAD_WALLET_ENTRY_STATUS.PAID;
    doc.paidAt = new Date();
    doc.paidAmountPaise = total;
  } else {
    doc.status = CAD_WALLET_ENTRY_STATUS.PENDING;
    doc.paidAt = null;
  }

  await doc.save();
  logger.info("cadWallet.recordPayment", {
    entryId: String(entryId),
    actorId: actor?._id ? String(actor._id) : null,
    deltaPaise: delta,
    payFull: Boolean(payFull),
  });

  return formatLedgerEntryForAdmin(
    await CadWalletLedger.findById(entryId)
      .populate("cadUser", "name auth")
      .populate("assignment", "status")
      .populate("surveyorSketchUpload", "applicationId surveyNo")
      .lean()
  );
}

function formatLedgerEntryForAdmin(row) {
  if (!row) return row;
  const paid = effectivePaidPaise(row);
  const total = Math.max(0, Number(row.amountPaise) || 0);
  const remaining = Math.max(0, total - paid);
  return {
    ...row,
    paidAmountPaise: paid,
    paidAmountRupees: paiseToRupees(paid),
    remainingPaise: remaining,
    remainingRupees: paiseToRupees(remaining),
    paidPercent: paidPercentForDoc(row),
  };
}

/** Full settlement in one step (same as recordPayment with payFull). */
async function markEntryPaid(entryId, actor) {
  return recordPayment(entryId, actor, { payFull: true });
}

/**
 * Admin payout by CAD user + amount.
 * Applies payment to oldest pending ledger entries first.
 */
async function recordPaymentForCadUser(cadUserId, actor, { amountPaise, payFull }) {
  const uid =
    cadUserId instanceof mongoose.Types.ObjectId
      ? cadUserId
      : new mongoose.Types.ObjectId(String(cadUserId));

  let amount;
  if (payFull) {
    const pendingSummary = await getSummaryForCad(uid);
    amount = Math.floor(Number(pendingSummary.pendingPaymentPaise) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestError("No pending balance to pay for this CAD user", {
        code: "NO_PENDING_BALANCE",
      });
    }
  } else {
    amount = Math.floor(Number(amountPaise) || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestError("amount must be a positive integer (paise)", {
        code: "INVALID_PAYMENT_AMOUNT",
      });
    }
  }

  let remainingToApply = amount;
  const pendingRows = await CadWalletLedger.find({ cadUser: uid, status: CAD_WALLET_ENTRY_STATUS.PENDING })
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  const touchedEntryIds = [];
  for (const row of pendingRows) {
    if (remainingToApply <= 0) break;
    const paid = effectivePaidPaise(row);
    const total = Math.max(0, Number(row.amountPaise) || 0);
    const remaining = Math.max(0, total - paid);
    if (remaining <= 0) continue;
    const delta = Math.min(remainingToApply, remaining);
    await recordPayment(row._id, actor, { payFull: false, amountPaise: delta });
    touchedEntryIds.push(row._id);
    remainingToApply -= delta;
  }

  const appliedPaise = amount - remainingToApply;
  const cadSummary = await getSummaryForCad(uid);

  return {
    cadUserId: uid,
    payFull: Boolean(payFull),
    requestedAmountPaise: amount,
    requestedAmountRupees: paiseToRupees(amount),
    appliedAmountPaise: appliedPaise,
    appliedAmountRupees: paiseToRupees(appliedPaise),
    unappliedAmountPaise: remainingToApply,
    unappliedAmountRupees: paiseToRupees(remainingToApply),
    touchedEntryIds,
    summary: cadSummary,
  };
}

function ledgerEffectivePaidAddFields() {
  const paidStr = CAD_WALLET_ENTRY_STATUS.PAID;
  return [
    {
      $addFields: {
        _paidRaw: { $ifNull: ["$paidAmountPaise", 0] },
      },
    },
    {
      $addFields: {
        effectivePaidPaise: {
          $min: [
            "$amountPaise",
            {
              $cond: [
                { $eq: ["$status", paidStr] },
                {
                  $cond: [{ $gt: ["$_paidRaw", 0] }, "$_paidRaw", "$amountPaise"],
                },
                { $max: [0, "$_paidRaw"] },
              ],
            },
          ],
        },
      },
    },
    {
      $addFields: {
        remainingPaise: {
          $max: [0, { $subtract: ["$amountPaise", "$effectivePaidPaise"] }],
        },
      },
    },
  ];
}

async function countOpenEntriesForCad(cadUserId) {
  const uid =
    cadUserId instanceof mongoose.Types.ObjectId
      ? cadUserId
      : new mongoose.Types.ObjectId(String(cadUserId));
  const [agg] = await CadWalletLedger.aggregate([
    { $match: { cadUser: uid } },
    ...ledgerEffectivePaidAddFields(),
    { $match: { remainingPaise: { $gt: 0 } } },
    { $count: "count" },
  ]);
  return agg?.count ?? 0;
}

async function loadCadUserForAdmin(cadUserId) {
  const user = await User.findOne({
    _id: cadUserId,
    role: USER_ROLES.CAD,
    deletedAt: null,
  })
    .select("name role auth.email auth.phone")
    .lean();
  if (!user) {
    throw new NotFoundError("CAD user not found", { code: "CAD_USER_NOT_FOUND" });
  }
  return user;
}

/**
 * Ensure wallet ledger rows exist for completed assignments (backfill + new deliveries).
 */
async function syncCadWalletFromCompletedAssignments(cadUserId) {
  const uid =
    cadUserId instanceof mongoose.Types.ObjectId
      ? cadUserId
      : new mongoose.Types.ObjectId(String(cadUserId));

  const assignments = await SurveySketchAssignment.find({
    assignedTo: uid,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
  })
    .select("_id surveyorSketchUpload")
    .lean();

  for (const assignment of assignments) {
    const upload = await SurveyorSketchUpload.findById(assignment.surveyorSketchUpload)
      .select("sketchPayment revisionFeePayments cadDeliverableHistory")
      .lean();
    if (!upload) continue;

    const history = Array.isArray(upload.cadDeliverableHistory) ? upload.cadDeliverableHistory : [];
    const hasInitial = history.some((h) => h && !h.isRevision);
    if (hasInitial) {
      await recordPendingEarningIfConfigured({
        cadUserId: uid,
        assignmentId: assignment._id,
        surveyorSketchUploadId: assignment.surveyorSketchUpload,
        kind: CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY,
        revisionNo: 0,
      });
    }

    const revisionNos = [
      ...new Set(
        history
          .filter((h) => h?.isRevision && h.revisionNo != null)
          .map((h) => Number(h.revisionNo))
          .filter((n) => Number.isFinite(n))
      ),
    ];
    for (const revNo of revisionNos) {
      await recordPendingEarningIfConfigured({
        cadUserId: uid,
        assignmentId: assignment._id,
        surveyorSketchUploadId: assignment.surveyorSketchUpload,
        kind: CAD_WALLET_ENTRY_KIND.REVISION_DELIVERY,
        revisionNo: revNo,
      });
    }
  }
}

function buildStatisticsFromSummary(summary, entries) {
  let rule = null;
  try {
    rule = cadPayoutPricing.getApprovedCadPayoutRule();
  } catch (_) {
    /* fail-closed surfaces elsewhere */
  }
  const totalSourcePaidPaise = entries.reduce(
    (sum, row) => sum + Math.max(0, Number(row.sourcePaidAmountPaise) || 0),
    0
  );
  const assignmentIds = new Set(
    entries.map((row) => String(row.assignment?._id || row.assignment || "")).filter(Boolean)
  );

  return {
    payoutModel: rule?.model || "FIXED",
    pricingRuleVersion: rule?.version || null,
    payoutPercent: null,
    standardOperatorPayoutPaise: rule?.operatorPayoutPaise ?? null,
    standardOperatorPayoutRupees: rule ? rule.operatorPayoutPaise / 100 : null,
    assignmentCount: assignmentIds.size,
    completedDeliveryCount: entries.length,
    totalSourcePaidPaise,
    totalSourcePaidRupees: paiseToRupees(totalSourcePaidPaise),
    totalSourcePaid: paiseToRupees(totalSourcePaidPaise),
    totalEarningsPaise: summary.totalEarningsPaise,
    totalEarningsRupees: summary.totalEarningsRupees,
    totalEarnings: summary.totalEarnings,
    receivedPaymentPaise: summary.receivedPaymentPaise,
    receivedPaymentRupees: summary.receivedPaymentRupees,
    receivedPayment: summary.receivedPayment,
    pendingPaymentPaise: summary.pendingPaymentPaise,
    pendingPaymentRupees: summary.pendingPaymentRupees,
    pendingPayment: summary.pendingPayment,
  };
}

async function buildAssignmentPayoutsForCad(cadUserId) {
  const entries = await CadWalletLedger.find({ cadUser: cadUserId })
    .sort({ createdAt: 1 })
    .populate({
      path: "assignment",
      select: "status completedAt assignedAt surveyorSketchUpload",
      populate: { path: "surveyorSketchUpload", select: "applicationId surveyNo" },
    })
    .populate("surveyorSketchUpload", "applicationId surveyNo")
    .lean();

  const byAssignment = new Map();
  for (const row of entries) {
    const assignmentDoc = row.assignment && typeof row.assignment === "object" ? row.assignment : null;
    const assignmentId = String(assignmentDoc?._id || row.assignment || row._id);
    const upload =
      assignmentDoc?.surveyorSketchUpload && typeof assignmentDoc.surveyorSketchUpload === "object"
        ? assignmentDoc.surveyorSketchUpload
        : row.surveyorSketchUpload && typeof row.surveyorSketchUpload === "object"
          ? row.surveyorSketchUpload
          : null;

    if (!byAssignment.has(assignmentId)) {
      byAssignment.set(assignmentId, {
        assignmentId: assignmentDoc?._id || row.assignment || null,
        applicationId: upload?.applicationId || null,
        surveyNo: upload?.surveyNo || null,
        status: assignmentDoc?.status || null,
        assignedAt: assignmentDoc?.assignedAt || null,
        completedAt: assignmentDoc?.completedAt || null,
        entries: [],
        assignmentEarnedPaise: 0,
        assignmentPaidPaise: 0,
        assignmentRemainingPaise: 0,
      });
    }

    const bucket = byAssignment.get(assignmentId);
    const formatted = formatLedgerEntryRow(row);
    bucket.entries.push(formatted);
    bucket.assignmentEarnedPaise += formatted.amountPaise;
    bucket.assignmentPaidPaise += formatted.paidAmountPaise;
    bucket.assignmentRemainingPaise += formatted.remainingPaise;
  }

  return [...byAssignment.values()].map((item) => ({
    ...item,
    assignmentEarnedRupees: paiseToRupees(item.assignmentEarnedPaise),
    assignmentPaidRupees: paiseToRupees(item.assignmentPaidPaise),
    assignmentRemainingRupees: paiseToRupees(item.assignmentRemainingPaise),
  }));
}

async function buildCadUserPayoutBundle(cadUser, { includeAssignments = true } = {}) {
  await syncCadWalletFromCompletedAssignments(cadUser._id);
  const [summary, pendingEntryCount, assignments] = await Promise.all([
    getSummaryForCad(cadUser._id),
    countOpenEntriesForCad(cadUser._id),
    includeAssignments ? buildAssignmentPayoutsForCad(cadUser._id) : Promise.resolve([]),
  ]);

  let statistics;
  if (includeAssignments) {
    const flatEntries = assignments.flatMap((a) => a.entries);
    statistics = buildStatisticsFromSummary(summary, flatEntries);
  } else {
    const ledgerRows = await CadWalletLedger.find({ cadUser: cadUser._id })
      .select("sourcePaidAmountPaise assignment")
      .lean();
    statistics = buildStatisticsFromSummary(summary, ledgerRows);
  }

  const result = {
    cadUser,
    summary,
    statistics,
    pendingEntryCount,
    payment: {
      maxPayablePaise: summary.pendingPaymentPaise,
      maxPayableRupees: summary.pendingPaymentRupees,
      maxPayable: summary.pendingPayment,
      canPayFull: summary.pendingPaymentPaise > 0,
    },
  };
  if (includeAssignments) {
    result.assignments = assignments;
  }
  return result;
}

/**
 * Admin: pending payout for one CAD user, or all CAD users (from User collection, role CAD).
 * @param {string|undefined} cadUserId
 */
async function getPendingPayoutSummaryForAdmin(cadUserId) {
  if (cadUserId) {
    validObjectIdOrThrow(cadUserId);
    const cadUser = await loadCadUserForAdmin(cadUserId);
    return buildCadUserPayoutBundle(cadUser, { includeAssignments: true });
  }

  const users = await User.find({ role: USER_ROLES.CAD, deletedAt: null })
    .select("name role auth.email auth.phone")
    .sort({ createdAt: -1 })
    .lean();

  const cadUsers = await Promise.all(
    users.map((cadUser) => buildCadUserPayoutBundle(cadUser, { includeAssignments: false }))
  );

  const totalPendingPaise = cadUsers.reduce((sum, item) => sum + item.summary.pendingPaymentPaise, 0);
  const totalEarningsPaise = cadUsers.reduce((sum, item) => sum + item.summary.totalEarningsPaise, 0);
  const totalReceivedPaise = cadUsers.reduce((sum, item) => sum + item.summary.receivedPaymentPaise, 0);
  const totalSourcePaidPaise = cadUsers.reduce(
    (sum, item) => sum + (item.statistics?.totalSourcePaidPaise || 0),
    0
  );

  return {
    pricingRuleVersion: cadPayoutPricing.getApprovedCadPayoutRule().version,
    payoutModel: "FIXED",
    payoutPercent: null,
    standardOperatorPayoutPaise: cadPayoutPricing.getApprovedCadPayoutRule().operatorPayoutPaise,
    totalPendingPaise,
    totalPendingRupees: paiseToRupees(totalPendingPaise),
    totalPending: paiseToRupees(totalPendingPaise),
    statistics: {
      payoutModel: "FIXED",
      pricingRuleVersion: cadPayoutPricing.getApprovedCadPayoutRule().version,
      payoutPercent: null,
      cadUserCount: cadUsers.length,
      assignmentCount: cadUsers.reduce((s, u) => s + (u.statistics?.assignmentCount || 0), 0),
      completedDeliveryCount: cadUsers.reduce((s, u) => s + (u.statistics?.completedDeliveryCount || 0), 0),
      totalSourcePaidPaise,
      totalSourcePaidRupees: paiseToRupees(totalSourcePaidPaise),
      totalSourcePaid: paiseToRupees(totalSourcePaidPaise),
      totalEarningsPaise,
      totalEarningsRupees: paiseToRupees(totalEarningsPaise),
      totalEarnings: paiseToRupees(totalEarningsPaise),
      receivedPaymentPaise: totalReceivedPaise,
      receivedPaymentRupees: paiseToRupees(totalReceivedPaise),
      receivedPayment: paiseToRupees(totalReceivedPaise),
      pendingPaymentPaise: totalPendingPaise,
      pendingPaymentRupees: paiseToRupees(totalPendingPaise),
      pendingPayment: paiseToRupees(totalPendingPaise),
    },
    cadUsers,
  };
}

function validObjectIdOrThrow(id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) {
    throw new BadRequestError("cadUserId must be a valid ObjectId", { code: "INVALID_CAD_USER_ID" });
  }
}

module.exports = {
  getInitialDeliveryPayoutPaise,
  getRevisionDeliveryPayoutPaise,
  recordPendingEarningIfConfigured,
  getSummaryForCad,
  listTransactionsForCad,
  recordPayment,
  recordPaymentForCadUser,
  markEntryPaid,
  effectivePaidPaise,
  paidPercentForDoc,
  getPendingPayoutSummaryForAdmin,
  syncCadWalletFromCompletedAssignments,
};
