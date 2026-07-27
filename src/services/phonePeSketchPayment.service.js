/**
 * PhonePe Standard Checkout for survey sketch submission and paid revisions (pg-sdk-node).
 * Env: PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION (default 1), PHONEPE_ENV (SANDBOX|PRODUCTION),
 * PUBLIC_API_BASE_URL (API Gateway base, no trailing slash), SKETCH_UPLOAD_FEE_PAISE, SKETCH_REVISION_FEE_PAISE,
 * PHONEPE_SUCCESS_REDIRECT_URL, PHONEPE_FAILURE_REDIRECT_URL.
 * Legacy: CLIENT_ID / CLIENT_SECRET accepted as aliases for PhonePe credentials.
 */

const logger = require("../utils/logger");
const { BadRequestError } = require("../utils/errors");

let _client;

function getEnvEnum() {
  const { Env } = require("pg-sdk-node");
  const name = (process.env.PHONEPE_ENV || "SANDBOX").toUpperCase();
  return name === "PRODUCTION" ? Env.PRODUCTION : Env.SANDBOX;
}

function getClient() {
  if (_client !== undefined) return _client;
  const clientId = process.env.PHONEPE_CLIENT_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET || process.env.CLIENT_SECRET;
  const clientVersion = parseInt(process.env.PHONEPE_CLIENT_VERSION || process.env.CLIENT_VERSION || "1", 10);
  if (!clientId || !clientSecret) {
    _client = null;
    return null;
  }
  try { 
    const { StandardCheckoutClient } = require("pg-sdk-node");
    _client = StandardCheckoutClient.getInstance(clientId, clientSecret, clientVersion, getEnvEnum());
    return _client;
  } catch (e) {
    logger.error("PhonePe StandardCheckoutClient init failed", e, {
      clientVersion,
      env: process.env.PHONEPE_ENV || "SANDBOX",
    });
    _client = null;
    return null;
  }
}

function isPhonePeConfigured() {
  return getClient() != null;
}

function getPublicApiBaseUrl() {
  return String(process.env.PUBLIC_API_BASE_URL || "").replace(/\/$/, "");
}

function getSketchUploadFeePaise() {
  const n = parseInt(process.env.SKETCH_UPLOAD_FEE_PAISE || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getSketchRevisionFeePaise() {
  const n = parseInt(process.env.SKETCH_REVISION_FEE_PAISE || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Balance fee (paise) after CAD delivery before download. Default ₹400 (40000). Set 0 to waive. */
function getSketchBalanceFeePaise() {
  const raw = process.env.SKETCH_BALANCE_FEE_PAISE;
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return 40000;
  }
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function getSuccessRedirectUrl() {
  return process.env.PHONEPE_SUCCESS_REDIRECT_URL || "http://localhost:5173/payment-success";
}

function getFailureRedirectUrl() {
  return process.env.PHONEPE_FAILURE_REDIRECT_URL || "http://www.localhost:5173/payment-failure";
}

/** PhonePe transaction / merchant order ids must stay ≤35 chars (alphanumeric + underscore). */
const PHONEPE_MAX_ORDER_ID_LEN = 35;

function sketchUploadMerchantOrderId(uploadId) {
  return `sketch_${String(uploadId)}`;
}

/** Fresh id per retry — shorter than `sketch_<id>_r<ms>` (exceeds 35 chars). Format: sk<24hex>r<base36> */
function sketchUploadRetryMerchantOrderId(uploadId) {
  const id = String(uploadId);
  const suffix = Date.now().toString(36).slice(-6);
  return `sk${id}r${suffix}`;
}

/** Balance payment checkout id. Format: bal<24hex> or bal<24hex>r<base36> (≤35 chars). */
function balancePaymentMerchantOrderId(uploadId) {
  const id = String(uploadId);
  const suffix = Date.now().toString(36).slice(-6);
  return `bal${id}r${suffix}`;
}

/**
 * @param {string} merchantOrderId
 * @returns {string|null} Mongo upload ObjectId string
 */
function parseSketchUploadIdFromMerchantOrder(merchantOrderId) {
  const s = String(merchantOrderId || "");
  let m = s.match(/^sketch_([a-f0-9]{24})(?:_|$)/i);
  if (m) return m[1];
  m = s.match(/^sk([a-f0-9]{24})r[a-z0-9]+$/i);
  if (m) return m[1];
  return null;
}

/**
 * @param {string} merchantOrderId
 * @returns {string|null} Mongo upload ObjectId string
 */
function parseBalanceUploadIdFromMerchantOrder(merchantOrderId) {
  const s = String(merchantOrderId || "");
  const m = s.match(/^bal([a-f0-9]{24})(?:r[a-z0-9]+)?$/i);
  return m ? m[1] : null;
}

function buildCallbackUrl(merchantOrderId) {
  const base = getPublicApiBaseUrl();
  if (!base) {
    throw new BadRequestError("PUBLIC_API_BASE_URL is required when sketch payment fees are enabled", {
      code: "PUBLIC_API_BASE_URL_REQUIRED",
    });
  }
  return `${base}/api/payments/phonepe/callback?merchantOrderId=${encodeURIComponent(merchantOrderId)}`;
}

/**
 * PhonePe / pg-sdk-node may return flat or nested shapes; extract any HTTPS checkout URL.
 * @param {unknown} res
 * @returns {string|null}
 */
function extractPayRedirectUrl(res) {
  if (res == null || typeof res !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (res);
  const candidates = [
    o.redirectUrl,
    o.redirect_url,
    o.checkoutUrl,
    o.checkoutPageUrl,
    o.url,
    o.data && typeof o.data === "object" ? /** @type {Record<string, unknown>} */ (o.data).redirectUrl : null,
    o.data && typeof o.data === "object" ? /** @type {Record<string, unknown>} */ (o.data).redirect_url : null,
    o.data && typeof o.data === "object" ? /** @type {Record<string, unknown>} */ (o.data).checkoutUrl : null,
    o.instrumentResponse && typeof o.instrumentResponse === "object"
      ? /** @type {Record<string, unknown>} */ (o.instrumentResponse).redirectUrl
      : null,
    o.response && typeof o.response === "object"
      ? /** @type {Record<string, unknown>} */ (o.response).redirectUrl
      : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && (c.startsWith("http://") || c.startsWith("https://"))) {
      return c;
    }
  }
  return null;
}

/**
 * @param {string} merchantOrderId
 * @param {number} amountPaise
 * @returns {Promise<{ redirectUrl: string }>}
 */
async function initiatePay(merchantOrderId, amountPaise) {
  const orderId = String(merchantOrderId || "").trim();
  if (!orderId) {
    throw new BadRequestError("merchantOrderId is required", { code: "PHONEPE_INVALID_ORDER_ID" });
  }
  if (orderId.length > PHONEPE_MAX_ORDER_ID_LEN) {
    throw new BadRequestError(
      `merchantOrderId must be at most ${PHONEPE_MAX_ORDER_ID_LEN} characters for PhonePe`,
      { code: "PHONEPE_INVALID_ORDER_ID" }
    );
  }
  const client = getClient();
  if (!client) {
    throw new Error("PhonePe is not configured (set PHONEPE_CLIENT_ID and PHONEPE_CLIENT_SECRET)");
  }
  const { StandardCheckoutPayRequest } = require("pg-sdk-node");
  const redirectUrl = buildCallbackUrl(orderId);
  const paymentRequest = StandardCheckoutPayRequest.builder(orderId)
    .merchantOrderId(orderId)
    .amount(amountPaise)
    .redirectUrl(redirectUrl)
    .build();
  const res = await client.pay(paymentRequest);
  const out = extractPayRedirectUrl(res);
  if (!out) {
    const keys = res && typeof res === "object" ? Object.keys(/** @type {object} */ (res)) : [];
    logger.error("PhonePe pay response missing checkout URL", { keys, sample: JSON.stringify(res).slice(0, 500) });
    throw new Error("PhonePe did not return a checkout URL");
  }
  return { redirectUrl: out };
}

function normalizeOrderState(response) {
  const s = response?.state ?? response?.status ?? response?.orderStatus;
  return s != null ? String(s) : "";
}

/**
 * Best-effort: read amount in paise from PhonePe order-status payload (shape varies by SDK/version).
 * @param {unknown} phonepeResponse
 * @returns {number|null}
 */
function extractPaidAmountPaise(phonepeResponse) {
  if (phonepeResponse == null || typeof phonepeResponse !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (phonepeResponse);
  const candidates = [
    o.amount,
    o.paidAmount,
    o.totalAmount,
    o.orderAmount,
    o.paymentAmount,
    o.payableAmount,
    typeof o.data === "object" && o.data != null ? /** @type {Record<string, unknown>} */ (o.data).amount : null,
    typeof o.data === "object" && o.data != null ? /** @type {Record<string, unknown>} */ (o.data).totalAmount : null,
    typeof o.paymentDetails === "object" && o.paymentDetails != null
      ? /** @type {Record<string, unknown>} */ (o.paymentDetails).amount
      : null,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

/**
 * Verify PhonePe paid amount matches the immutable expected amount stored on the order.
 * Fail closed: missing expected, missing paid, or mismatch → reject.
 * @param {number|null|undefined} expectedPaise
 * @param {unknown} phonepeResponse
 * @returns {{ ok: true, paidPaise: number } | { ok: false, reason: string, paidPaise: number|null, expectedPaise: number|null }}
 */
function assertPaidMatchesExpected(expectedPaise, phonepeResponse) {
  const expected =
    expectedPaise != null && Number.isFinite(Number(expectedPaise)) ? Math.round(Number(expectedPaise)) : null;
  const paid = extractPaidAmountPaise(phonepeResponse);

  if (expected == null || expected <= 0) {
    return { ok: false, reason: "MISSING_EXPECTED_AMOUNT", paidPaise: paid, expectedPaise: expected };
  }
  if (paid == null) {
    return { ok: false, reason: "MISSING_PAID_AMOUNT", paidPaise: null, expectedPaise: expected };
  }
  if (paid !== expected) {
    return { ok: false, reason: "AMOUNT_MISMATCH", paidPaise: paid, expectedPaise: expected };
  }
  return { ok: true, paidPaise: paid };
}

/**
 * Browser redirect handler after PhonePe (GET callback).
 * @param {string} merchantOrderId
 * @returns {Promise<{ redirectUrl: string }>}
 */
async function handlePhonePeCallback(merchantOrderId) {
  const successUrl = getSuccessRedirectUrl();
  const failUrl = getFailureRedirectUrl();
  if (!merchantOrderId || typeof merchantOrderId !== "string") {
    return { redirectUrl: failUrl };
  }

  const client = getClient();
  let orderState = "";
  let phonepeResponse = {};
  if (client) {
    try {
      // Server-to-server confirmation only (audit §4.1 point 28) — browser redirect never marks paid alone.
      const response = await client.getOrderStatus(merchantOrderId);
      orderState = normalizeOrderState(response);
      phonepeResponse = response && typeof response === "object" ? response : {};
    } catch (e) {
      logger.error("PhonePe getOrderStatus failed", e, { merchantOrderId });
    }
  }

  const completed = String(orderState).toUpperCase() === "COMPLETED";
  const surveyorSketchUploadService = require("./surveyorSketchUpload.service");
  const surveySketchAssignmentService = require("./assignment/surveySketchAssignment.service");
  const cadDownloadEntitlement = require("./cadDownloadEntitlement.service");
  const paymentAttempt = require("./paymentAttempt.service");

  // Immutable attempt ledger transition (points 26–27). No-op path if legacy order has no attempt row yet.
  const attemptResult = await paymentAttempt.applyProviderCallback({
    merchantOrderId,
    phonepeResponse,
    completed,
    assertPaidMatchesExpected,
  });

  if (attemptResult.reason === "UNKNOWN_PAYMENT_ATTEMPT") {
    // Fall through to legacy routing for pre-ledger payments.
  } else if (attemptResult.attempt) {
    const lockedUploadId = String(attemptResult.uploadId);
    const purpose = attemptResult.attempt.purpose;

    // Callback cannot override order identity: parsed id must match locked attempt identity.
    let parsedUploadId = null;
    if (merchantOrderId.startsWith("bal")) {
      parsedUploadId = parseBalanceUploadIdFromMerchantOrder(merchantOrderId);
    } else if (merchantOrderId.startsWith("sketch_") || merchantOrderId.startsWith("sk")) {
      parsedUploadId = parseSketchUploadIdFromMerchantOrder(merchantOrderId);
    } else if (merchantOrderId.startsWith("rev_")) {
      const m = String(merchantOrderId).match(/^rev_([a-f0-9]{24})_(\d+)$/i);
      parsedUploadId = m ? m[1] : null;
    }
    if (parsedUploadId && parsedUploadId !== lockedUploadId) {
      logger.error("PhonePe callback order identity mismatch", {
        merchantOrderId,
        parsedUploadId,
        lockedUploadId,
      });
      return { redirectUrl: failUrl };
    }

    if (!attemptResult.ok) {
      if (purpose === paymentAttempt.PAYMENT_PURPOSE.BALANCE) {
        await cadDownloadEntitlement.markBalancePaymentFailed(lockedUploadId, phonepeResponse);
      } else if (purpose === paymentAttempt.PAYMENT_PURPOSE.BOOKING) {
        await surveyorSketchUploadService.markSketchPaymentFailed(lockedUploadId, phonepeResponse);
      } else if (purpose === paymentAttempt.PAYMENT_PURPOSE.REVISION) {
        await surveySketchAssignmentService.markRevisionPaymentFailed(merchantOrderId, phonepeResponse);
      }
      return { redirectUrl: failUrl };
    }

    if (purpose === paymentAttempt.PAYMENT_PURPOSE.BALANCE) {
      const result = await cadDownloadEntitlement.completeBalancePaymentAfterPhonePe(
        lockedUploadId,
        phonepeResponse,
        { merchantOrderId, expectedAmountPaise: attemptResult.expectedPaise }
      );
      return { redirectUrl: result?.paymentRejected ? failUrl : successUrl };
    }
    if (purpose === paymentAttempt.PAYMENT_PURPOSE.BOOKING) {
      const result = await surveyorSketchUploadService.completeSketchUploadAfterPayment(
        lockedUploadId,
        phonepeResponse,
        { merchantOrderId, expectedAmountPaise: attemptResult.expectedPaise }
      );
      return { redirectUrl: result?.paymentRejected ? failUrl : successUrl };
    }
    if (purpose === paymentAttempt.PAYMENT_PURPOSE.REVISION) {
      const result = await surveySketchAssignmentService.completeRevisionAfterPayment(
        merchantOrderId,
        phonepeResponse
      );
      return { redirectUrl: result?.paymentRejected ? failUrl : successUrl };
    }
  }

  // Legacy routing (orders initiated before payment_attempts existed)
  if (merchantOrderId.startsWith("bal")) {
    const uploadId = parseBalanceUploadIdFromMerchantOrder(merchantOrderId);
    if (!uploadId) {
      logger.error("PhonePe callback: could not parse balance upload id", { merchantOrderId });
      return { redirectUrl: failUrl };
    }
    if (!completed) {
      await cadDownloadEntitlement.markBalancePaymentFailed(uploadId, phonepeResponse);
      return { redirectUrl: failUrl };
    }
    const result = await cadDownloadEntitlement.completeBalancePaymentAfterPhonePe(
      uploadId,
      phonepeResponse,
      { merchantOrderId }
    );
    if (result?.paymentRejected) {
      return { redirectUrl: failUrl };
    }
    return { redirectUrl: successUrl };
  }

  if (merchantOrderId.startsWith("sketch_") || merchantOrderId.startsWith("sk")) {
    const uploadId = parseSketchUploadIdFromMerchantOrder(merchantOrderId);
    if (!uploadId) {
      logger.error("PhonePe callback: could not parse sketch upload id", { merchantOrderId });
      return { redirectUrl: failUrl };
    }
    if (!completed) {
      await surveyorSketchUploadService.markSketchPaymentFailed(uploadId, phonepeResponse);
      return { redirectUrl: failUrl };
    }
    const result = await surveyorSketchUploadService.completeSketchUploadAfterPayment(
      uploadId,
      phonepeResponse,
      { merchantOrderId }
    );
    if (result?.paymentRejected) {
      return { redirectUrl: failUrl };
    }
    return { redirectUrl: successUrl };
  }

  if (merchantOrderId.startsWith("rev_")) {
    if (!completed) {
      await surveySketchAssignmentService.markRevisionPaymentFailed(merchantOrderId, phonepeResponse);
      return { redirectUrl: failUrl };
    }
    const result = await surveySketchAssignmentService.completeRevisionAfterPayment(
      merchantOrderId,
      phonepeResponse
    );
    if (result?.paymentRejected) {
      return { redirectUrl: failUrl };
    }
    return { redirectUrl: successUrl };
  }

  return { redirectUrl: failUrl };
}

module.exports = {
  getClient,
  isPhonePeConfigured,
  getPublicApiBaseUrl,
  getSketchUploadFeePaise,
  getSketchRevisionFeePaise,
  getSketchBalanceFeePaise,
  getSuccessRedirectUrl,
  getFailureRedirectUrl,
  buildCallbackUrl,
  extractPayRedirectUrl,
  extractPaidAmountPaise,
  assertPaidMatchesExpected,
  initiatePay,
  handlePhonePeCallback,
  sketchUploadMerchantOrderId,
  sketchUploadRetryMerchantOrderId,
  balancePaymentMerchantOrderId,
  parseSketchUploadIdFromMerchantOrder,
  parseBalanceUploadIdFromMerchantOrder,
};
