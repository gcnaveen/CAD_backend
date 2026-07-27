/**
 * Daily payment reconciliation — audit §4.1 point 29.
 * Flags: missing, duplicated, mismatched, expired, refunded, manually adjusted.
 */

const PaymentAttempt = require("../models/payment/PaymentAttempt");
const {
  PROVIDER_STATE,
  RECON_FLAG,
} = require("../models/payment/PaymentAttempt");

function getPendingExpireMs() {
  const n = parseInt(process.env.PAYMENT_ATTEMPT_EXPIRE_MS || String(24 * 60 * 60 * 1000), 10);
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function endOfUtcDay(d = new Date()) {
  const s = startOfUtcDay(d);
  return new Date(s.getTime() + 24 * 60 * 60 * 1000);
}

/**
 * Run reconciliation for a calendar day (UTC) or custom window.
 * Updates attempt.reconciliationFlags when new flags are detected.
 */
async function runDailyReconciliation(options = {}) {
  const asOf = options.asOf ? new Date(options.asOf) : new Date();
  const from = options.from ? new Date(options.from) : startOfUtcDay(asOf);
  const to = options.to ? new Date(options.to) : endOfUtcDay(asOf);
  const expireBefore = new Date(Date.now() - getPendingExpireMs());
  const persist = options.persist !== false;

  const attempts = await PaymentAttempt.find({
    initiatedAt: { $gte: from, $lt: to },
  })
    .sort({ initiatedAt: 1 })
    .lean();

  const summary = {
    from: from.toISOString(),
    to: to.toISOString(),
    totalAttempts: attempts.length,
    flags: {
      [RECON_FLAG.MISSING]: 0,
      [RECON_FLAG.DUPLICATED]: 0,
      [RECON_FLAG.MISMATCHED]: 0,
      [RECON_FLAG.EXPIRED]: 0,
      [RECON_FLAG.REFUNDED]: 0,
      [RECON_FLAG.MANUALLY_ADJUSTED]: 0,
    },
    items: [],
  };

  /** @type {Map<string, object[]>} */
  const completedByKey = new Map();

  for (const a of attempts) {
    const found = [];

    if (a.providerState === PROVIDER_STATE.AMOUNT_MISMATCH) {
      found.push({ flag: RECON_FLAG.MISMATCHED, note: a.failureReason || "amount_mismatch" });
    }
    if (
      a.providerState === PROVIDER_STATE.COMPLETED &&
      Number(a.paidAmountPaise) !== Number(a.expectedAmountPaise)
    ) {
      found.push({ flag: RECON_FLAG.MISMATCHED, note: "paid_ne_expected" });
    }
    if (a.providerState === PROVIDER_STATE.REFUNDED) {
      found.push({ flag: RECON_FLAG.REFUNDED, note: "refunded" });
    }
    if (a.manuallyAdjusted) {
      found.push({ flag: RECON_FLAG.MANUALLY_ADJUSTED, note: "manually_adjusted" });
    }
    if (
      a.providerState === PROVIDER_STATE.PENDING &&
      a.initiatedAt &&
      new Date(a.initiatedAt).getTime() < expireBefore.getTime()
    ) {
      found.push({ flag: RECON_FLAG.EXPIRED, note: "pending_past_ttl" });
      found.push({ flag: RECON_FLAG.MISSING, note: "no_successful_callback" });
    }
    if (a.providerState === PROVIDER_STATE.FAILED) {
      found.push({ flag: RECON_FLAG.MISSING, note: "failed_without_success" });
    }

    if (a.providerState === PROVIDER_STATE.COMPLETED) {
      const key = `${a.purpose}:${String(a.surveyorSketchUpload)}:${a.revisionNo ?? ""}`;
      if (!completedByKey.has(key)) completedByKey.set(key, []);
      completedByKey.get(key).push(a);
    }

    if (found.length) {
      for (const f of found) {
        summary.flags[f.flag] = (summary.flags[f.flag] || 0) + 1;
      }
      summary.items.push({
        attemptId: String(a._id),
        merchantOrderId: a.merchantOrderId,
        purpose: a.purpose,
        uploadId: String(a.surveyorSketchUpload),
        providerState: a.providerState,
        expectedAmountPaise: a.expectedAmountPaise,
        paidAmountPaise: a.paidAmountPaise,
        flags: found,
      });

      if (persist) {
        const existing = new Set((a.reconciliationFlags || []).map((r) => r.flag));
        const toAdd = found.filter((f) => !existing.has(f.flag));
        if (toAdd.length) {
          const $set = {};
          if (toAdd.some((f) => f.flag === RECON_FLAG.EXPIRED) && a.providerState === PROVIDER_STATE.PENDING) {
            $set.providerState = PROVIDER_STATE.EXPIRED;
          }
          await PaymentAttempt.updateOne(
            { _id: a._id },
            {
              ...(Object.keys($set).length ? { $set } : {}),
              $push: {
                reconciliationFlags: {
                  $each: toAdd.map((f) => ({
                    flag: f.flag,
                    at: new Date(),
                    note: f.note,
                  })),
                },
              },
            }
          );
        }
      }
    }
  }

  // Duplicated successful payments for same order purpose
  for (const [key, rows] of completedByKey.entries()) {
    if (rows.length < 2) continue;
    summary.flags[RECON_FLAG.DUPLICATED] += rows.length;
    for (const a of rows) {
      summary.items.push({
        attemptId: String(a._id),
        merchantOrderId: a.merchantOrderId,
        purpose: a.purpose,
        uploadId: String(a.surveyorSketchUpload),
        providerState: a.providerState,
        expectedAmountPaise: a.expectedAmountPaise,
        paidAmountPaise: a.paidAmountPaise,
        flags: [{ flag: RECON_FLAG.DUPLICATED, note: `key=${key};count=${rows.length}` }],
      });
      if (persist) {
        const hasDup = (a.reconciliationFlags || []).some((r) => r.flag === RECON_FLAG.DUPLICATED);
        if (!hasDup) {
          await PaymentAttempt.updateOne(
            { _id: a._id },
            {
              $push: {
                reconciliationFlags: {
                  flag: RECON_FLAG.DUPLICATED,
                  at: new Date(),
                  note: `key=${key};count=${rows.length}`,
                },
              },
            }
          );
        }
      }
    }
  }

  return summary;
}

module.exports = {
  runDailyReconciliation,
  getPendingExpireMs,
};
