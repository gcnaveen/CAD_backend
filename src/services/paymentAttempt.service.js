/**
 * Payment attempt lifecycle — audit §4.1 points 25–28.
 * - Order/attempt owns expectedAmountPaise; browser never sets it.
 * - Attempt owns immutable merchantOrderId + expected amount + order identity.
 * - Callback applies idempotent transitions; cannot override amount or order identity.
 * - Paid only after server-to-server provider status matches expected amount.
 */

const PaymentAttempt = require("../models/payment/PaymentAttempt");
const {
  PAYMENT_PURPOSE,
  PROVIDER_STATE,
  RECON_FLAG,
} = require("../models/payment/PaymentAttempt");
const { extractPaidAmountPaise } = require("./phonePeSketchPayment.service");
const logger = require("../utils/logger");

const TERMINAL_STATES = new Set([
  PROVIDER_STATE.COMPLETED,
  PROVIDER_STATE.AMOUNT_MISMATCH,
  PROVIDER_STATE.REFUNDED,
]);

/**
 * Strip secrets / credentials; keep only signed reference fields useful for audit.
 */
function sanitizeProviderReference(phonepeResponse, merchantOrderId) {
  if (phonepeResponse == null || typeof phonepeResponse !== "object") {
    return {
      merchantOrderId: merchantOrderId || null,
      state: null,
      amountPaise: null,
      transactionId: null,
      orderId: null,
    };
  }
  const o = /** @type {Record<string, unknown>} */ (phonepeResponse);
  const nested =
    o.data && typeof o.data === "object" ? /** @type {Record<string, unknown>} */ (o.data) : {};
  const paymentDetails =
    o.paymentDetails && typeof o.paymentDetails === "object"
      ? /** @type {Record<string, unknown>} */ (o.paymentDetails)
      : nested.paymentDetails && typeof nested.paymentDetails === "object"
        ? /** @type {Record<string, unknown>} */ (nested.paymentDetails)
        : {};

  const state = o.state ?? o.status ?? o.orderStatus ?? nested.state ?? null;
  const transactionId =
    o.transactionId ||
    o.txnId ||
    paymentDetails.transactionId ||
    paymentDetails.txnId ||
    nested.transactionId ||
    null;
  const orderId = o.orderId || nested.orderId || merchantOrderId || null;

  return {
    merchantOrderId: merchantOrderId || null,
    orderId: orderId != null ? String(orderId) : null,
    state: state != null ? String(state) : null,
    amountPaise: extractPaidAmountPaise(phonepeResponse),
    transactionId: transactionId != null ? String(transactionId) : null,
    // Explicitly omit tokens, secrets, keys, auth headers, full raw payload.
  };
}

async function recordInitiated({
  purpose,
  surveyorSketchUploadId,
  surveyorId,
  merchantOrderId,
  expectedAmountPaise,
  revisionNo = null,
}) {
  const expected = Math.round(Number(expectedAmountPaise));
  if (!merchantOrderId || !surveyorSketchUploadId || !Number.isFinite(expected) || expected <= 0) {
    throw new Error("Invalid payment attempt initiation");
  }

  const { getRequestOrigin } = require("../utils/requestContext");
  const { sanitizeReturnOrigin } = require("./phonePeSketchPayment.service");
  const returnOrigin = sanitizeReturnOrigin(getRequestOrigin());

  try {
    const doc = await PaymentAttempt.create({
      purpose,
      surveyorSketchUpload: surveyorSketchUploadId,
      surveyor: surveyorId || null,
      revisionNo,
      merchantOrderId: String(merchantOrderId),
      expectedAmountPaise: expected,
      providerState: PROVIDER_STATE.PENDING,
      initiatedAt: new Date(),
      providerReference: {
        ...sanitizeProviderReference(null, merchantOrderId),
        ...(returnOrigin ? { returnOrigin } : {}),
      },
    });
    return doc;
  } catch (err) {
    if (err && err.code === 11000) {
      // Idempotent re-init with same merchantOrderId — return existing; never change expected/identity.
      return PaymentAttempt.findOne({ merchantOrderId: String(merchantOrderId) });
    }
    throw err;
  }
}

/**
 * Idempotent callback transition.
 * Uses attempt.expectedAmountPaise + attempt.surveyorSketchUpload — never callback-supplied amount/identity.
 *
 * @returns {{
 *   ok: boolean,
 *   reason?: string,
 *   attempt?: object,
 *   expectedPaise?: number,
 *   paidPaise?: number|null,
 *   uploadId?: string,
 *   alreadyTerminal?: boolean
 * }}
 */
async function applyProviderCallback({
  merchantOrderId,
  phonepeResponse,
  completed,
  assertPaidMatchesExpected,
}) {
  const orderId = String(merchantOrderId || "");
  if (!orderId) {
    return { ok: false, reason: "MISSING_MERCHANT_ORDER_ID" };
  }

  const attempt = await PaymentAttempt.findOne({ merchantOrderId: orderId });
  if (!attempt) {
    logger.error("Payment callback: unknown merchantOrderId (no attempt)", { merchantOrderId: orderId });
    return { ok: false, reason: "UNKNOWN_PAYMENT_ATTEMPT" };
  }

  const uploadId = String(attempt.surveyorSketchUpload);
  const expectedPaise = Number(attempt.expectedAmountPaise);
  const ref = sanitizeProviderReference(phonepeResponse, orderId);

  if (TERMINAL_STATES.has(attempt.providerState) && attempt.providerState === PROVIDER_STATE.COMPLETED) {
    attempt.lastProviderCheckAt = new Date();
    attempt.providerReference = ref;
    await attempt.save();
    return {
      ok: true,
      alreadyTerminal: true,
      attempt,
      expectedPaise,
      paidPaise: attempt.paidAmountPaise,
      uploadId,
    };
  }

  if (!completed) {
    if (attempt.providerState !== PROVIDER_STATE.COMPLETED) {
      attempt.providerState = PROVIDER_STATE.FAILED;
      attempt.failureReason = "PROVIDER_NOT_COMPLETED";
      attempt.lastProviderCheckAt = new Date();
      attempt.providerReference = ref;
      await attempt.save();
    }
    return {
      ok: false,
      reason: "PROVIDER_NOT_COMPLETED",
      attempt,
      expectedPaise,
      paidPaise: ref.amountPaise,
      uploadId,
    };
  }

  const match = assertPaidMatchesExpected(expectedPaise, phonepeResponse);
  if (!match.ok) {
    attempt.providerState = PROVIDER_STATE.AMOUNT_MISMATCH;
    attempt.paidAmountPaise = match.paidPaise;
    attempt.failureReason = match.reason;
    attempt.lastProviderCheckAt = new Date();
    attempt.providerReference = ref;
    attempt.reconciliationFlags = attempt.reconciliationFlags || [];
    attempt.reconciliationFlags.push({
      flag: RECON_FLAG.MISMATCHED,
      at: new Date(),
      note: match.reason,
    });
    await attempt.save();
    return {
      ok: false,
      reason: match.reason,
      attempt,
      expectedPaise,
      paidPaise: match.paidPaise,
      uploadId,
    };
  }

  // Success — amount already verified against immutable expectedAmountPaise
  attempt.providerState = PROVIDER_STATE.COMPLETED;
  attempt.paidAmountPaise = match.paidPaise;
  attempt.failureReason = null;
  attempt.completedAt = attempt.completedAt || new Date();
  attempt.lastProviderCheckAt = new Date();
  attempt.providerReference = ref;
  await attempt.save();

  return {
    ok: true,
    alreadyTerminal: false,
    attempt,
    expectedPaise,
    paidPaise: match.paidPaise,
    uploadId,
  };
}

async function markAttemptRefunded(merchantOrderId, { note } = {}) {
  const attempt = await PaymentAttempt.findOne({ merchantOrderId: String(merchantOrderId) });
  if (!attempt) return null;
  attempt.providerState = PROVIDER_STATE.REFUNDED;
  attempt.manuallyAdjusted = true;
  attempt.reconciliationFlags = attempt.reconciliationFlags || [];
  attempt.reconciliationFlags.push({
    flag: RECON_FLAG.REFUNDED,
    at: new Date(),
    note: note || "refunded",
  });
  attempt.reconciliationFlags.push({
    flag: RECON_FLAG.MANUALLY_ADJUSTED,
    at: new Date(),
    note: note || "refunded",
  });
  await attempt.save();
  return attempt;
}

module.exports = {
  PAYMENT_PURPOSE,
  PROVIDER_STATE,
  RECON_FLAG,
  sanitizeProviderReference,
  recordInitiated,
  applyProviderCallback,
  markAttemptRefunded,
};
