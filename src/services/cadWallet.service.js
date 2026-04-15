/**
 * CAD wallet: pending / paid payouts for completed deliveries.
 * Amounts come from env (paise). Zero = no ledger row created.
 */

const mongoose = require("mongoose");
const CadWalletLedger = require("../models/cad/CadWalletLedger");
const { CAD_WALLET_ENTRY_STATUS, CAD_WALLET_ENTRY_KIND } = require("../config/constants");
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

function paiseToRupees(paise) {
  return Math.round(Number(paise) || 0) / 100;
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
 * Record a pending earning if env payout for this kind is > 0. Idempotent per (assignment, kind, revisionNo).
 */
async function recordPendingEarningIfConfigured({
  cadUserId,
  assignmentId,
  surveyorSketchUploadId,
  kind,
  revisionNo,
}) {
  const amountPaise =
    kind === CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY
      ? getInitialDeliveryPayoutPaise()
      : getRevisionDeliveryPayoutPaise();
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

  return {
    totalEarningsPaise,
    pendingPaymentPaise,
    receivedPaymentPaise,
    totalEarningsRupees: paiseToRupees(totalEarningsPaise),
    pendingPaymentRupees: paiseToRupees(pendingPaymentPaise),
    receivedPaymentRupees: paiseToRupees(receivedPaymentPaise),
    /** Same values in rupees, names requested by frontend. */
    totalEarnings: paiseToRupees(totalEarningsPaise),
    pendingPayment: paiseToRupees(pendingPaymentPaise),
    receivedPayment: paiseToRupees(receivedPaymentPaise),
  };
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

  const rows = data.map((row) => {
    const paid = effectivePaidPaise(row);
    const total = Math.max(0, Number(row.amountPaise) || 0);
    const remaining = Math.max(0, total - paid);
    let balanceStatus = "PENDING";
    if (total <= 0 || remaining <= 0) balanceStatus = "PAID";
    else if (paid > 0) balanceStatus = "PARTIAL";
    return {
      _id: row._id,
      kind: row.kind,
      revisionNo: row.revisionNo,
      amountPaise: row.amountPaise,
      amountRupees: paiseToRupees(row.amountPaise),
      paidAmountPaise: paid,
      paidAmountRupees: paiseToRupees(paid),
      remainingPaise: remaining,
      remainingRupees: paiseToRupees(remaining),
      paidPercent: paidPercentForDoc(row),
      balanceStatus,
      status: row.status,
      paidAt: row.paidAt,
      paymentLog: row.paymentLog || [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assignment: row.assignment,
      surveyorSketchUpload: row.surveyorSketchUpload,
    };
  });

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

module.exports = {
  getInitialDeliveryPayoutPaise,
  getRevisionDeliveryPayoutPaise,
  recordPendingEarningIfConfigured,
  getSummaryForCad,
  listTransactionsForCad,
  recordPayment,
  markEntryPaid,
  effectivePaidPaise,
  paidPercentForDoc,
};
