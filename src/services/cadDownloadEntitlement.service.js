/**
 * Audit C-02: CAD deliverable download entitlement.
 * Surveyor download requires reconciled balance payment (₹100 booking + ₹400 balance model).
 * Browser / order status alone must never grant file access.
 */

const { randomUUID } = require("crypto");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const sketchPaymentPricing = require("./sketchPaymentPricing.service");
const phonePeSketchPayment = require("./phonePeSketchPayment.service");
const s3 = require("../utils/s3");
const { USER_ROLES, SURVEY_SKETCH_STATUS } = require("../config/constants");
const { ForbiddenError, NotFoundError, BadRequestError } = require("../utils/errors");
const logger = require("../utils/logger");

const DELIVERED_STATUSES = new Set([
  SURVEY_SKETCH_STATUS.CAD_DELIVERED,
  SURVEY_SKETCH_STATUS.UNDER_REVISION,
  SURVEY_SKETCH_STATUS.APPROVED,
]);

const BALANCE_PAYMENT_STATUSES = Object.freeze({
  NONE: "NONE",
  REQUIRED: "REQUIRED",
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  REFUNDED: "REFUNDED",
});

function getDownloadUrlTtlSeconds() {
  const n = parseInt(process.env.CAD_DOWNLOAD_URL_TTL_SECONDS || "120", 10);
  if (!Number.isFinite(n)) return 120;
  return Math.min(900, Math.max(30, n));
}

function normalizeFiles(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((f) => f && (f.url || f.fileName || f.mimeType))
    .map((f) => ({
      url: f.url != null ? String(f.url) : null,
      fileName: f.fileName != null ? String(f.fileName) : null,
      mimeType: f.mimeType != null ? String(f.mimeType) : null,
      size: f.size != null && f.size !== "" ? Number(f.size) : null,
      uploadedAt: f.uploadedAt || null,
    }));
}

function hasDeliverableFiles(upload) {
  return normalizeFiles(upload?.cadDeliverable).length > 0;
}

function isRefunded(upload) {
  const bp = upload?.balancePayment || {};
  return bp.status === BALANCE_PAYMENT_STATUSES.REFUNDED || bp.refundedAt != null;
}

/**
 * Authoritative server-side entitlement. Never trust client or `granted` flag alone.
 * Rules:
 * - refunded → deny
 * - amount not locked → deny
 * - amountPaise === 0 → fee waived → allow
 * - otherwise require COMPLETED + paidAmountPaise === amountPaise
 */
function isDownloadEntitled(upload) {
  if (!upload) return false;
  if (isRefunded(upload)) return false;

  const expectedRaw = upload.balancePayment?.amountPaise;
  if (expectedRaw == null || !Number.isFinite(Number(expectedRaw))) {
    return false;
  }
  const expected = Number(expectedRaw);
  if (expected <= 0) {
    return true;
  }

  const paid = Number(upload.balancePayment?.paidAmountPaise);
  return (
    upload.balancePayment?.status === BALANCE_PAYMENT_STATUSES.COMPLETED &&
    Number.isFinite(paid) &&
    paid === expected
  );
}

function appendBalanceLedger(uploadDoc, event, extra = {}) {
  if (!uploadDoc.balancePayment) {
    uploadDoc.balancePayment = {};
  }
  if (!Array.isArray(uploadDoc.balancePayment.ledger)) {
    uploadDoc.balancePayment.ledger = [];
  }
  uploadDoc.balancePayment.ledger.push({
    at: new Date(),
    event: String(event),
    merchantOrderId: extra.merchantOrderId != null ? String(extra.merchantOrderId) : null,
    amountPaise: extra.amountPaise != null ? Number(extra.amountPaise) : null,
    paidAmountPaise: extra.paidAmountPaise != null ? Number(extra.paidAmountPaise) : null,
    reasonCode: extra.reasonCode != null ? String(extra.reasonCode) : null,
    policyVersion: extra.policyVersion != null ? String(extra.policyVersion) : null,
    note: extra.note != null ? String(extra.note).slice(0, 500) : null,
  });
}

/**
 * Lock immutable balance amount at first CAD delivery (or lazy ensure for legacy rows).
 * Mutates uploadDoc in memory; caller saves.
 */
async function applyBalanceRequirementOnDelivery(uploadDoc) {
  if (!uploadDoc) return;

  if (isRefunded(uploadDoc)) {
    uploadDoc.downloadEntitlement = {
      granted: false,
      grantedAt: null,
      reason: "REFUNDED",
      revokedAt: uploadDoc.balancePayment?.refundedAt || new Date(),
    };
    return;
  }

  if (
    uploadDoc.balancePayment?.status === BALANCE_PAYMENT_STATUSES.COMPLETED &&
    Number(uploadDoc.balancePayment?.paidAmountPaise) === Number(uploadDoc.balancePayment?.amountPaise) &&
    Number(uploadDoc.balancePayment?.amountPaise) > 0
  ) {
    uploadDoc.downloadEntitlement = {
      granted: true,
      grantedAt: uploadDoc.downloadEntitlement?.grantedAt || uploadDoc.balancePayment.paidAt || new Date(),
      reason: "BALANCE_PAID",
      revokedAt: null,
    };
    return;
  }

  const alreadyLocked =
    uploadDoc.balancePayment?.amountPaise != null && Number.isFinite(Number(uploadDoc.balancePayment.amountPaise));

  if (!alreadyLocked) {
    const resolved = await sketchPaymentPricing.resolveSketchBalanceFee();
    uploadDoc.balancePayment = {
      status: resolved.feePaise > 0 ? BALANCE_PAYMENT_STATUSES.REQUIRED : BALANCE_PAYMENT_STATUSES.NONE,
      merchantOrderId: null,
      amountPaise: resolved.feePaise,
      planAmountRupees: resolved.planAmountRupees,
      discountRupees: resolved.discountRupees,
      pricingSource: resolved.source,
      paidAmountPaise: null,
      paymentFailureReason: null,
      phonepeResponse: null,
      paidAt: null,
      refundedAt: null,
      ledger: Array.isArray(uploadDoc.balancePayment?.ledger) ? uploadDoc.balancePayment.ledger : [],
    };
    appendBalanceLedger(uploadDoc, "AMOUNT_LOCKED", {
      amountPaise: resolved.feePaise,
      note: `source=${resolved.source}`,
    });
  }

  const expected = Number(uploadDoc.balancePayment.amountPaise) || 0;
  if (expected <= 0) {
    if (
      uploadDoc.downloadEntitlement?.granted === true &&
      uploadDoc.downloadEntitlement?.reason === "FEE_WAIVED"
    ) {
      return;
    }
    uploadDoc.balancePayment.status = BALANCE_PAYMENT_STATUSES.NONE;
    uploadDoc.downloadEntitlement = {
      granted: true,
      grantedAt: uploadDoc.downloadEntitlement?.grantedAt || new Date(),
      reason: "FEE_WAIVED",
      revokedAt: null,
    };
    appendBalanceLedger(uploadDoc, "FEE_WAIVED", { amountPaise: 0 });
    return;
  }

  const st = uploadDoc.balancePayment.status;
  if (
    !st ||
    st === BALANCE_PAYMENT_STATUSES.NONE ||
    st === BALANCE_PAYMENT_STATUSES.COMPLETED
  ) {
    // COMPLETED without matching paid is treated as required again
    if (st !== BALANCE_PAYMENT_STATUSES.COMPLETED) {
      uploadDoc.balancePayment.status = BALANCE_PAYMENT_STATUSES.REQUIRED;
    } else if (Number(uploadDoc.balancePayment.paidAmountPaise) !== expected) {
      uploadDoc.balancePayment.status = BALANCE_PAYMENT_STATUSES.REQUIRED;
    }
  }

  if (uploadDoc.balancePayment.status !== BALANCE_PAYMENT_STATUSES.COMPLETED) {
    uploadDoc.downloadEntitlement = {
      granted: false,
      grantedAt: null,
      reason: null,
      revokedAt: null,
    };
  }
}

async function ensureBalanceRequirementForUpload(uploadDoc) {
  if (!uploadDoc) return uploadDoc;
  if (!hasDeliverableFiles(uploadDoc) && !DELIVERED_STATUSES.has(uploadDoc.status)) {
    return uploadDoc;
  }
  const needsInit =
    uploadDoc.balancePayment?.amountPaise == null &&
    uploadDoc.downloadEntitlement?.granted !== true;
  if (!needsInit && uploadDoc.downloadEntitlement?.granted != null) {
    return uploadDoc;
  }
  await applyBalanceRequirementOnDelivery(uploadDoc);
  return uploadDoc;
}

function redactFileMeta(files) {
  return normalizeFiles(files).map((f) => ({
    fileName: f.fileName,
    mimeType: f.mimeType,
    size: f.size,
    uploadedAt: f.uploadedAt,
    urlWithheld: true,
  }));
}

function buildEntitlementMeta(upload) {
  const entitled = isDownloadEntitled(upload);
  const expected = upload.balancePayment?.amountPaise;
  const status = upload.balancePayment?.status || BALANCE_PAYMENT_STATUSES.NONE;
  return {
    granted: entitled,
    reason: entitled
      ? upload.downloadEntitlement?.reason ||
        (Number(expected) <= 0 ? "FEE_WAIVED" : "BALANCE_PAID")
      : isRefunded(upload)
        ? "REFUNDED"
        : status === BALANCE_PAYMENT_STATUSES.PENDING
          ? "BALANCE_PAYMENT_PENDING"
          : status === BALANCE_PAYMENT_STATUSES.AMOUNT_MISMATCH
            ? "AMOUNT_MISMATCH"
            : status === BALANCE_PAYMENT_STATUSES.FAILED
              ? "BALANCE_PAYMENT_FAILED"
              : hasDeliverableFiles(upload)
                ? "BALANCE_PAYMENT_REQUIRED"
                : "NOT_DELIVERED",
    balancePaymentStatus: status,
    amountPaise: expected != null ? Number(expected) : null,
    payableRupees: expected != null && Number.isFinite(Number(expected)) ? Number(expected) / 100 : null,
    paidAmountPaise: upload.balancePayment?.paidAmountPaise ?? null,
    refunded: isRefunded(upload),
    downloadApi: "GET /api/surveyor/sketch-uploads/{uploadId}/cad-download",
    balancePaymentApi: "POST /api/surveyor/sketch-uploads/{uploadId}/balance-payment",
  };
}

/**
 * Strip permanent deliverable URLs and payment internals from surveyor-facing payloads (C-02).
 * Admins / CAD keep raw URLs (ops); surveyor must use cad-download API only.
 */
function presentUploadForActor(upload, actor) {
  if (!upload) return upload;
  const role = actor?.role;
  if (role !== USER_ROLES.SURVEYOR) {
    return {
      ...upload,
      downloadEntitlement: buildEntitlementMeta(upload),
    };
  }

  const out = { ...upload };
  out.cadDeliverable = redactFileMeta(upload.cadDeliverable);
  if (Array.isArray(upload.cadDeliverableHistory)) {
    out.cadDeliverableHistory = upload.cadDeliverableHistory.map((row) => ({
      ...row,
      deliverables: redactFileMeta(row?.deliverables),
      deliverable: row?.deliverable ? redactFileMeta([row.deliverable])[0] : null,
    }));
  }

  // Do not expose PhonePe raw payloads, download grant tokens, or entitlement flag as authority.
  if (out.balancePayment && typeof out.balancePayment === "object") {
    const bp = { ...out.balancePayment };
    delete bp.phonepeResponse;
    if (Array.isArray(bp.ledger)) {
      bp.ledger = bp.ledger.map((row) => ({
        at: row?.at || null,
        event: row?.event || null,
        merchantOrderId: row?.merchantOrderId || null,
        amountPaise: row?.amountPaise ?? null,
        paidAmountPaise: row?.paidAmountPaise ?? null,
        note: row?.note || null,
      }));
    }
    out.balancePayment = bp;
  }
  delete out.downloadGrants;
  // Recompute entitlement view from payment state (never echo a stale/tampered granted flag as truth).
  out.downloadEntitlement = buildEntitlementMeta(upload);
  return out;
}

async function initiateBalancePayment(surveyor, uploadId) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can pay sketch balance", { code: "SURVEYOR_ONLY" });
  }

  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (String(upload.surveyor) !== String(surveyor._id)) {
    throw new ForbiddenError("You can pay balance only for your own uploads", {
      code: "NOT_YOUR_SKETCH",
    });
  }

  await ensureBalanceRequirementForUpload(upload);

  if (!hasDeliverableFiles(upload)) {
    throw new BadRequestError("CAD deliverable is not ready yet", { code: "CAD_NOT_DELIVERED" });
  }
  if (isRefunded(upload)) {
    throw new BadRequestError("Balance payment was refunded; download is blocked", {
      code: "BALANCE_REFUNDED",
    });
  }
  if (isDownloadEntitled(upload)) {
    await upload.save();
    return {
      data: presentUploadForActor(upload.toObject(), surveyor),
      meta: {
        payment: {
          requiresPayment: false,
          alreadyEntitled: true,
          message: "Download already unlocked",
        },
      },
    };
  }

  const feePaise = Number(upload.balancePayment.amountPaise);
  if (!Number.isFinite(feePaise) || feePaise <= 0) {
    await applyBalanceRequirementOnDelivery(upload);
    await upload.save();
    return {
      data: presentUploadForActor(upload.toObject(), surveyor),
      meta: {
        payment: { requiresPayment: false, alreadyEntitled: true, message: "Balance fee waived" },
      },
    };
  }

  if (!phonePeSketchPayment.isPhonePeConfigured()) {
    throw new BadRequestError("PhonePe is not configured for balance payment", {
      code: "PHONEPE_NOT_CONFIGURED",
    });
  }

  const merchantOrderId = phonePeSketchPayment.balancePaymentMerchantOrderId(upload._id);
  const pay = await phonePeSketchPayment.initiatePay(merchantOrderId, feePaise);

  upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.PENDING;
  upload.balancePayment.merchantOrderId = merchantOrderId;
  upload.balancePayment.paymentFailureReason = null;
  appendBalanceLedger(upload, "CHECKOUT_INITIATED", {
    merchantOrderId,
    amountPaise: feePaise,
  });
  await upload.save();

  try {
    const paymentAttempt = require("./paymentAttempt.service");
    await paymentAttempt.recordInitiated({
      purpose: paymentAttempt.PAYMENT_PURPOSE.BALANCE,
      surveyorSketchUploadId: upload._id,
      surveyorId: surveyor._id,
      merchantOrderId,
      expectedAmountPaise: feePaise,
    });
  } catch (ledgerErr) {
    logger.error("Failed to record balance payment attempt", ledgerErr, {
      uploadId: String(uploadId),
      merchantOrderId,
    });
  }

  return {
    data: presentUploadForActor(upload.toObject(), surveyor),
    meta: {
      payment: {
        requiresPayment: true,
        checkoutPageUrl: pay.redirectUrl,
        redirectUrl: pay.redirectUrl,
        merchantOrderId,
        amountPaise: feePaise,
        planAmountRupees: upload.balancePayment.planAmountRupees,
        discountRupees: upload.balancePayment.discountRupees,
        payableRupees: feePaise / 100,
        pricingSource: upload.balancePayment.pricingSource,
        purpose: "CAD_BALANCE",
        message: "Pay the balance amount to unlock CAD download",
      },
    },
  };
}

async function completeBalancePaymentAfterPhonePe(uploadId, phonepeResponse, { merchantOrderId, expectedAmountPaise } = {}) {
  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    logger.error("Balance payment complete: upload not found", { uploadId });
    return { paymentRejected: true, reason: "UPLOAD_NOT_FOUND" };
  }

  if (
    upload.balancePayment?.status === BALANCE_PAYMENT_STATUSES.COMPLETED &&
    isDownloadEntitled(upload)
  ) {
    return { paymentRejected: false, alreadyCompleted: true };
  }

  if (isRefunded(upload)) {
    return { paymentRejected: true, reason: "REFUNDED" };
  }

  const storedOrderId = upload.balancePayment?.merchantOrderId
    ? String(upload.balancePayment.merchantOrderId)
    : null;
  if (merchantOrderId && storedOrderId && storedOrderId !== String(merchantOrderId)) {
    const PaymentAttempt = require("../models/payment/PaymentAttempt");
    const knownAttempt = await PaymentAttempt.findOne({
      merchantOrderId: String(merchantOrderId),
      surveyorSketchUpload: uploadId,
    })
      .select("_id")
      .lean();
    if (!knownAttempt) {
      logger.error("PhonePe balance merchantOrderId mismatch", {
        uploadId: String(uploadId),
        storedOrderId,
        callbackOrderId: String(merchantOrderId),
      });
      upload.balancePayment = upload.balancePayment || {};
      upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.AMOUNT_MISMATCH;
      upload.balancePayment.paymentFailureReason = "MERCHANT_ORDER_ID_MISMATCH";
      upload.balancePayment.phonepeResponse = phonepeResponse;
      upload.downloadEntitlement = {
        granted: false,
        grantedAt: null,
        reason: null,
        revokedAt: null,
      };
      appendBalanceLedger(upload, "MERCHANT_ORDER_ID_MISMATCH", {
        merchantOrderId,
        amountPaise: upload.balancePayment.amountPaise,
      });
      await upload.save();
      return { paymentRejected: true, reason: "MERCHANT_ORDER_ID_MISMATCH" };
    }
  }

  await ensureBalanceRequirementForUpload(upload);
  const expected =
    expectedAmountPaise != null && Number.isFinite(Number(expectedAmountPaise))
      ? Math.round(Number(expectedAmountPaise))
      : Number(upload.balancePayment?.amountPaise);
  const match = phonePeSketchPayment.assertPaidMatchesExpected(expected, phonepeResponse);
  if (!match.ok) {
    logger.error("PhonePe balance payment amount rejected", {
      uploadId: String(uploadId),
      reason: match.reason,
      expectedPaise: match.expectedPaise,
      paidPaise: match.paidPaise,
    });
    upload.balancePayment = upload.balancePayment || {};
    upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.AMOUNT_MISMATCH;
    upload.balancePayment.paymentFailureReason = match.reason;
    upload.balancePayment.paidAmountPaise = match.paidPaise;
    upload.balancePayment.phonepeResponse = phonepeResponse;
    if (merchantOrderId) upload.balancePayment.merchantOrderId = merchantOrderId;
    upload.downloadEntitlement = {
      granted: false,
      grantedAt: null,
      reason: null,
      revokedAt: null,
    };
    appendBalanceLedger(upload, "AMOUNT_MISMATCH", {
      merchantOrderId,
      amountPaise: expected,
      paidAmountPaise: match.paidPaise,
      note: match.reason,
    });
    await upload.save();
    return { paymentRejected: true, reason: match.reason };
  }

  upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.COMPLETED;
  upload.balancePayment.phonepeResponse = phonepeResponse;
  upload.balancePayment.paidAt = new Date();
  upload.balancePayment.paidAmountPaise = match.paidPaise;
  upload.balancePayment.paymentFailureReason = null;
  if (merchantOrderId) upload.balancePayment.merchantOrderId = merchantOrderId;
  upload.downloadEntitlement = {
    granted: true,
    grantedAt: new Date(),
    reason: "BALANCE_PAID",
    revokedAt: null,
  };
  appendBalanceLedger(upload, "PAYMENT_COMPLETED", {
    merchantOrderId,
    amountPaise: expected,
    paidAmountPaise: match.paidPaise,
  });
  await upload.save();
  return { paymentRejected: false, alreadyCompleted: false };
}

async function markBalancePaymentFailed(uploadId, phonepeResponse) {
  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) return;
  if (upload.balancePayment?.status === BALANCE_PAYMENT_STATUSES.COMPLETED) return;
  upload.balancePayment = upload.balancePayment || {};
  upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.FAILED;
  if (phonepeResponse != null) upload.balancePayment.phonepeResponse = phonepeResponse;
  upload.downloadEntitlement = {
    granted: false,
    grantedAt: null,
    reason: null,
    revokedAt: null,
  };
  appendBalanceLedger(upload, "PAYMENT_FAILED", {
    merchantOrderId: upload.balancePayment.merchantOrderId,
    amountPaise: upload.balancePayment.amountPaise,
  });
  await upload.save();
}

/**
 * Admin: mark balance as refunded — exceptional ops only (approved refund policy).
 * Irrevocably revokes download entitlement (audit C-02). Not a customer entitlement.
 */
async function markBalanceRefunded(actor, uploadId, payload = {}) {
  if (actor.role !== USER_ROLES.ADMIN && actor.role !== USER_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("Only admin can mark balance refunded", { code: "ADMIN_ONLY" });
  }

  const { assertExceptionalAdminRefundAllowed } = require("../config/refundPolicy");
  const approved = assertExceptionalAdminRefundAllowed(payload);

  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  upload.balancePayment = upload.balancePayment || {};
  if (upload.balancePayment.status === BALANCE_PAYMENT_STATUSES.REFUNDED) {
    throw new BadRequestError("Balance payment is already marked REFUNDED", {
      code: "ALREADY_REFUNDED",
    });
  }
  upload.balancePayment.status = BALANCE_PAYMENT_STATUSES.REFUNDED;
  upload.balancePayment.refundedAt = new Date();
  upload.balancePayment.refundReasonCode = approved.reasonCode;
  upload.balancePayment.refundPolicyVersion = approved.policyVersion;
  upload.downloadEntitlement = {
    granted: false,
    grantedAt: null,
    reason: "REFUNDED",
    revokedAt: new Date(),
  };
  appendBalanceLedger(upload, "REFUNDED", {
    merchantOrderId: upload.balancePayment.merchantOrderId,
    amountPaise: upload.balancePayment.amountPaise,
    paidAmountPaise: upload.balancePayment.paidAmountPaise,
    reasonCode: approved.reasonCode,
    policyVersion: approved.policyVersion,
    note: approved.note,
  });
  await upload.save();

  try {
    const paymentAttempt = require("./paymentAttempt.service");
    if (upload.balancePayment.merchantOrderId) {
      await paymentAttempt.markAttemptRefunded(upload.balancePayment.merchantOrderId, {
        note: `${approved.reasonCode}: ${approved.note}`,
      });
    }
  } catch (ledgerErr) {
    logger.error("Failed to mark payment attempt refunded", ledgerErr, {
      uploadId: String(uploadId),
    });
  }

  return presentUploadForActor(upload.toObject(), actor);
}

function entitlementDenialCode(upload) {
  if (isRefunded(upload)) return "BALANCE_REFUNDED";
  const st = upload?.balancePayment?.status;
  if (st === BALANCE_PAYMENT_STATUSES.PENDING) return "BALANCE_PAYMENT_PENDING";
  if (st === BALANCE_PAYMENT_STATUSES.AMOUNT_MISMATCH) return "AMOUNT_MISMATCH";
  if (st === BALANCE_PAYMENT_STATUSES.FAILED) return "BALANCE_PAYMENT_FAILED";
  if (!hasDeliverableFiles(upload)) return "CAD_NOT_DELIVERED";
  return "BALANCE_PAYMENT_REQUIRED";
}

/**
 * Issue short-lived signed GET URLs. Requires ownership + delivery + reconciled balance.
 * Optional one-use grantId: replay of the same grantId is rejected.
 */
async function getCadDownloadForSurveyor(surveyor, uploadId, { grantId } = {}) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can download CAD deliverables", { code: "SURVEYOR_ONLY" });
  }

  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (String(upload.surveyor) !== String(surveyor._id)) {
    const { logFileAccess } = require("./fileAccessLog.service");
    await logFileAccess({
      action: "ACCESS_DENIED_CROSS_USER",
      actorUserId: surveyor._id,
      actorRole: surveyor.role,
      uploadId: upload._id,
      success: false,
      code: "NOT_YOUR_SKETCH",
    });
    throw new ForbiddenError("You can download only your own uploads", { code: "NOT_YOUR_SKETCH" });
  }

  await ensureBalanceRequirementForUpload(upload);

  if (!hasDeliverableFiles(upload)) {
    throw new BadRequestError("CAD deliverable is not ready yet", { code: "CAD_NOT_DELIVERED" });
  }

  if (!isDownloadEntitled(upload)) {
    const code = entitlementDenialCode(upload);
    throw new ForbiddenError("Balance payment required before CAD download", {
      code,
      errors: { downloadEntitlement: buildEntitlementMeta(upload) },
    });
  }

  if (grantId) {
    const grants = Array.isArray(upload.downloadGrants) ? upload.downloadGrants : [];
    const existing = grants.find((g) => g && String(g.grantId) === String(grantId));
    if (existing) {
      if (existing.usedAt) {
        throw new ForbiddenError("Download grant already used", { code: "DOWNLOAD_GRANT_REPLAYED" });
      }
      if (existing.expiresAt && new Date(existing.expiresAt).getTime() < Date.now()) {
        throw new ForbiddenError("Download grant expired", { code: "DOWNLOAD_GRANT_EXPIRED" });
      }
      existing.usedAt = new Date();
    } else {
      throw new ForbiddenError("Unknown download grant", { code: "DOWNLOAD_GRANT_INVALID" });
    }
  }

  const ttl = getDownloadUrlTtlSeconds();
  const expiresAt = new Date(Date.now() + ttl * 1000);
  const newGrantId = randomUUID();
  if (!Array.isArray(upload.downloadGrants)) upload.downloadGrants = [];
  upload.downloadGrants.push({
    grantId: newGrantId,
    issuedAt: new Date(),
    expiresAt,
    usedAt: null,
  });
  if (upload.downloadGrants.length > 20) {
    upload.downloadGrants = upload.downloadGrants.slice(-20);
  }
  appendBalanceLedger(upload, "DOWNLOAD_URLS_ISSUED", {
    amountPaise: upload.balancePayment?.amountPaise,
    note: `grantId=${newGrantId};ttl=${ttl}`,
  });
  await upload.save();

  const files = normalizeFiles(upload.cadDeliverable);
  const outFiles = [];
  for (const file of files) {
    const key = s3.keyFromFileUrl(file.url);
    if (!key) {
      logger.error("CAD download: could not resolve S3 key from url", {
        uploadId: String(uploadId),
        fileName: file.fileName,
      });
      throw new BadRequestError("Deliverable file is not available for signed download", {
        code: "DELIVERABLE_KEY_UNRESOLVED",
      });
    }
    const downloadUrl = await s3.getPresignedGetUrl(key, ttl);
    outFiles.push({
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
      downloadUrl,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: ttl,
    });
  }

  const { logFileAccess } = require("./fileAccessLog.service");
  await logFileAccess({
    action: "DOWNLOAD_ISSUED",
    actorUserId: surveyor._id,
    actorRole: surveyor.role,
    uploadId: upload._id,
    success: true,
    meta: {
      grantId: newGrantId,
      ttl,
      fileCount: outFiles.length,
      watermarkPolicy: require("./fileSecurity.service").getWatermarkPolicy(),
    },
  });

  return {
    uploadId: String(upload._id),
    applicationId: upload.applicationId || null,
    grantId: newGrantId,
    expiresAt: expiresAt.toISOString(),
    expiresInSeconds: ttl,
    files: outFiles,
    downloadEntitlement: buildEntitlementMeta(upload),
  };
}

module.exports = {
  BALANCE_PAYMENT_STATUSES,
  isDownloadEntitled,
  isRefunded,
  hasDeliverableFiles,
  applyBalanceRequirementOnDelivery,
  ensureBalanceRequirementForUpload,
  presentUploadForActor,
  buildEntitlementMeta,
  initiateBalancePayment,
  completeBalancePaymentAfterPhonePe,
  markBalancePaymentFailed,
  markBalanceRefunded,
  getCadDownloadForSurveyor,
  getDownloadUrlTtlSeconds,
  appendBalanceLedger,
};
