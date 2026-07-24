/**
 * Surveyor Sketch Upload Service
 * Create and list survey sketch submissions (surveyor-only create; list own).
 */

const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const SurveyDraft = require("../models/surveyor/SurveyDraft");
const User = require("../models/user/User");
const District = require("../models/masters/District");
const Taluka = require("../models/masters/Taluka");
const Hobli = require("../models/masters/Hobli");
const Village = require("../models/masters/Village");
const surveySketchAssignmentService = require("./assignment/surveySketchAssignment.service");
const flowService = require("./config/surveySketchAssignmentFlow.service");
const sketchPaymentPricing = require("./sketchPaymentPricing.service");
const phonePeSketchPayment = require("./phonePeSketchPayment.service");
const notificationService = require("./notification.service");
const { USER_ROLES, SURVEY_SKETCH_ASSIGNMENT_STATUS, SURVEY_SKETCH_STATUS } = require("../config/constants");
const { ForbiddenError, NotFoundError, BadRequestError } = require("../utils/errors");
const logger = require("../utils/logger");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** After a sketch is in workflow PENDING (not PAYMENT_PENDING): auto-assign + surveyor notification. */
async function postSubmitNotifyAndAutoAssign(docId, surveyorRef) {
  try {
    const flow = await flowService.getAutoAssignState();
    if (flow.enabled && flow.updatedBy) {
      await surveySketchAssignmentService.autoAssignFromFlow(docId, flow.updatedBy);
    }
  } catch (autoAssignError) {
    logger.error("Auto assignment flow failed after sketch creation", autoAssignError, {
      surveyorSketchUploadId: String(docId),
    });
  }

  const latest = await SurveyorSketchUpload.findById(docId).lean();
  try {
    const sid = surveyorRef._id != null ? surveyorRef._id : surveyorRef;
    await notificationService.create({
      type: "SURVEY_SKETCH_UPLOADED",
      title: "Survey sketch uploaded",
      message: `Sketch ${latest?.applicationId || ""} uploaded and submitted.`,
      entityType: "SurveyorSketchUpload",
      entityId: docId,
      targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN],
      targetUsers: [sid],
      createdBy: sid,
      data: {
        surveyNo: latest?.surveyNo,
        status: latest?.status,
      },
    });
  } catch (notificationError) {
    logger.error("Failed to create upload notification", notificationError, {
      surveyorSketchUploadId: String(docId),
    });
  }
  return latest;
}

/**
 * PhonePe callback: move upload from PAYMENT_PENDING → PENDING and run auto-assign + notification.
 * Idempotent if payment already marked COMPLETED.
 */
async function completeSketchUploadAfterPayment(uploadId, phonepeResponse) {
  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) return null;
  if (upload.sketchPayment?.status === "COMPLETED") {
    return SurveyorSketchUpload.findById(uploadId).lean();
  }

  upload.status = SURVEY_SKETCH_STATUS.PENDING;
  upload.sketchPayment = upload.sketchPayment || {};
  upload.sketchPayment.status = "COMPLETED";
  upload.sketchPayment.phonepeResponse = phonepeResponse;
  upload.sketchPayment.paidAt = new Date();
  const paidPaise =
    phonePeSketchPayment.extractPaidAmountPaise(phonepeResponse) ?? upload.sketchPayment.amountPaise ?? null;
  if (paidPaise != null && Number.isFinite(Number(paidPaise))) {
    upload.sketchPayment.paidAmountPaise = Math.round(Number(paidPaise));
  }
  await upload.save();

  await postSubmitNotifyAndAutoAssign(upload._id, { _id: upload.surveyor });
  return SurveyorSketchUpload.findById(uploadId).lean();
}

async function markSketchPaymentFailed(uploadId, phonepeResponse) {
  await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
    $set: {
      "sketchPayment.status": "FAILED",
      ...(phonepeResponse != null ? { "sketchPayment.phonepeResponse": phonepeResponse } : {}),
    },
  });
}

function sketchUploadMerchantOrderId(uploadId) {
  return phonePeSketchPayment.sketchUploadMerchantOrderId(uploadId);
}

function sketchUploadRetryMerchantOrderId(uploadId) {
  return phonePeSketchPayment.sketchUploadRetryMerchantOrderId(uploadId);
}

async function loadSketchUploadDetail(uploadId) {
  return SurveyorSketchUpload.findById(uploadId)
    .populate("surveyor", "name role")
    .populate("district", "code name")
    .populate("taluka", "code name")
    .populate("hobli", "code name")
    .populate("village", "code name")
    .lean();
}

function buildSketchPaymentMeta({
  checkoutPageUrl,
  merchantOrderId,
  feePaise,
  resolved,
  message,
}) {
  return {
    payment: {
      requiresPayment: true,
      checkoutPageUrl,
      redirectUrl: checkoutPageUrl,
      merchantOrderId,
      amountPaise: feePaise,
      planAmountRupees: resolved.planAmountRupees,
      discountRupees: resolved.discountRupees,
      payableRupees: resolved.payableRupees,
      pricingSource: resolved.source,
      ...(message ? { message } : {}),
    },
  };
}

/**
 * Re-initiate PhonePe checkout when initial sketch upload payment failed or was abandoned.
 * @param {Object} surveyor
 * @param {string} uploadId
 */
/**
 * Re-initiate PhonePe checkout for an unpaid sketch upload.
 * Optional body.amountPaise / amountRupees / amount overrides the charged amount.
 */
async function reinitiateSketchPayment(surveyor, uploadId, options = {}) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can retry sketch upload payment");
  }

  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (String(upload.surveyor) !== String(surveyor._id)) {
    throw new ForbiddenError("You can retry payment only for your own uploads", {
      code: "NOT_YOUR_SKETCH",
    });
  }
  if (upload.status !== SURVEY_SKETCH_STATUS.PAYMENT_PENDING) {
    const payStatusEarly = upload.sketchPayment?.status || "NONE";
    if (payStatusEarly === "FAILED" && Number(upload.sketchPayment?.amountPaise) > 0) {
      upload.status = SURVEY_SKETCH_STATUS.PAYMENT_PENDING;
    } else {
      throw new BadRequestError("This upload is not awaiting payment", {
        code: "SKETCH_NOT_AWAITING_PAYMENT",
      });
    }
  }

  const payStatus = upload.sketchPayment?.status || "NONE";
  if (payStatus === "COMPLETED") {
    throw new BadRequestError("Payment is already completed for this upload", {
      code: "SKETCH_PAYMENT_ALREADY_COMPLETED",
    });
  }

  const clientAmountPaise = options.amountPaise;
  const baseResolved = await sketchPaymentPricing.resolveSketchUploadFee(clientAmountPaise);
  const feePaise =
    clientAmountPaise != null && Number(clientAmountPaise) > 0
      ? Math.round(Number(clientAmountPaise))
      : Number(upload.sketchPayment?.amountPaise) > 0
        ? Math.round(Number(upload.sketchPayment.amountPaise))
        : baseResolved.feePaise;
  const resolved =
    clientAmountPaise != null && Number(clientAmountPaise) > 0
      ? baseResolved
      : Number(upload.sketchPayment?.amountPaise) > 0
        ? {
            feePaise,
            planAmountRupees: upload.sketchPayment.planAmountRupees ?? null,
            discountRupees: upload.sketchPayment.discountRupees ?? null,
            payableRupees: feePaise / 100,
            source: "stored",
          }
        : baseResolved;

  if (!Number.isFinite(feePaise) || feePaise <= 0) {
    throw new BadRequestError("No payment is required for this upload", {
      code: "SKETCH_PAYMENT_NOT_REQUIRED",
    });
  }

  const phonePe = phonePeSketchPayment;
  if (!phonePe.isPhonePeConfigured()) {
    throw new BadRequestError("Sketch upload fee is configured but PhonePe is not configured.", {
      code: "PHONEPE_NOT_CONFIGURED",
    });
  }

  const merchantOrderId = sketchUploadRetryMerchantOrderId(upload._id);
  upload.sketchPayment = upload.sketchPayment || {};
  upload.sketchPayment.status = "PENDING";
  upload.sketchPayment.merchantOrderId = merchantOrderId;
  upload.sketchPayment.amountPaise = feePaise;
  upload.sketchPayment.planAmountRupees = resolved.planAmountRupees ?? upload.sketchPayment.planAmountRupees ?? null;
  upload.sketchPayment.discountRupees = resolved.discountRupees ?? upload.sketchPayment.discountRupees ?? null;
  upload.status = SURVEY_SKETCH_STATUS.PAYMENT_PENDING;
  await upload.save();

  let checkoutPageUrl;
  try {
    logger.info("PhonePe initiatePay sketch upload retry", {
      uploadId: String(uploadId),
      merchantOrderId,
      amountPaise: feePaise,
      payableRupees: feePaise / 100,
      pricingSource: resolved.source,
    });
    const pr = await phonePe.initiatePay(merchantOrderId, feePaise);
    checkoutPageUrl = pr.redirectUrl;
  } catch (pe) {
    logger.error("PhonePe initiatePay failed for sketch upload payment retry", pe, {
      uploadId: String(uploadId),
    });
    await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
      $set: { "sketchPayment.status": "FAILED" },
    });
    if (pe instanceof BadRequestError) throw pe;
    throw new BadRequestError(pe?.message || "Payment gateway error", { code: "PHONEPE_INIT_FAILED" });
  }

  const data = await loadSketchUploadDetail(uploadId);
  return {
    data,
    meta: buildSketchPaymentMeta({
      checkoutPageUrl,
      merchantOrderId,
      feePaise,
      resolved,
      message:
        payStatus === "FAILED"
          ? "Payment retry started. Complete checkout to submit your sketch."
          : "Checkout link refreshed. Complete payment to submit your sketch.",
    }),
  };
}

/**
 * Remove an unpaid sketch upload (surveyor "Clear" action).
 * Allowed only while payment is not completed and upload has not entered workflow.
 * @param {Object} surveyor
 * @param {string} uploadId
 */
async function clearSketchUpload(surveyor, uploadId) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can clear sketch uploads");
  }

  const upload = await SurveyorSketchUpload.findById(uploadId);
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (String(upload.surveyor) !== String(surveyor._id)) {
    throw new ForbiddenError("You can clear only your own uploads", { code: "NOT_YOUR_SKETCH" });
  }

  const payStatus = upload.sketchPayment?.status || "NONE";
  if (payStatus === "COMPLETED") {
    throw new BadRequestError("Cannot clear a survey that has already been paid", {
      code: "SKETCH_ALREADY_PAID",
    });
  }

  const clearable =
    upload.status === SURVEY_SKETCH_STATUS.PAYMENT_PENDING ||
    (payStatus === "FAILED" && Number(upload.sketchPayment?.amountPaise) > 0);

  if (!clearable) {
    throw new BadRequestError("Only unpaid surveys awaiting payment can be cleared", {
      code: "SKETCH_NOT_CLEARABLE",
    });
  }

  const activeAssignment = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: {
      $in: [
        SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
        SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
        SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
      ],
    },
  })
    .select("_id")
    .lean();

  if (activeAssignment) {
    throw new BadRequestError("Cannot clear a survey that is already in CAD workflow", {
      code: "SKETCH_IN_WORKFLOW",
    });
  }

  await SurveySketchAssignment.deleteMany({ surveyorSketchUpload: uploadId });
  const deleted = await SurveyorSketchUpload.findOneAndDelete({
    _id: uploadId,
    surveyor: surveyor._id,
  });

  if (!deleted) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }

  logger.info("Surveyor cleared unpaid sketch upload", {
    uploadId: String(uploadId),
    surveyorId: String(surveyor._id),
    applicationId: deleted.applicationId || null,
  });

  return {
    uploadId: String(uploadId),
    applicationId: deleted.applicationId || null,
    message: "Survey upload removed",
  };
}

/** When several assignment rows exist per sketch (e.g. cancelled then reassigned), show the active one, else latest. */
function pickDisplayAssignmentForUpload(rows) {
  if (!rows?.length) return null;
  const active = rows.filter((a) => a.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED);
  const pool = active.length ? active : rows;
  return [...pool].sort((a, b) => {
    const ta = a.assignedAt ? new Date(a.assignedAt).getTime() : 0;
    const tb = b.assignedAt ? new Date(b.assignedAt).getTime() : 0;
    return tb - ta;
  })[0];
}
 
const SURVEYOR_ORDER_BUCKETS = Object.freeze({
  ALL: "all",
  ACTIVE: "active",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
});



const ORDER_BUCKET_TO_STATUSES = Object.freeze({
  [SURVEYOR_ORDER_BUCKETS.ACTIVE]: ["PAYMENT_PENDING", "PENDING", "ASSIGNED", "CAD_DELIVERED", "UNDER_REVISION"],
  [SURVEYOR_ORDER_BUCKETS.COMPLETED]: ["APPROVED"],
  [SURVEYOR_ORDER_BUCKETS.CANCELLED]: ["REJECTED"],
});

const VALID_ORDER_STATUSES = new Set(Object.values(SURVEY_SKETCH_STATUS));

function normalizeOrderStatus(raw) {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "UNDER_REVIEW") return SURVEY_SKETCH_STATUS.UNDER_REVISION;
  return s;
}

function parseStatusFilter(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const parts = String(raw)
    .split(",")
    .map((p) => normalizeOrderStatus(p))
    .filter(Boolean);
  if (!parts.length) return null;
  const unique = [...new Set(parts)];
  const invalid = unique.filter((s) => !VALID_ORDER_STATUSES.has(s));
  if (invalid.length) {
    throw new BadRequestError(
      `status must be one or more of: ${[...VALID_ORDER_STATUSES].join(", ")}`,
      { code: "INVALID_ORDER_STATUS", errors: invalid.map((s) => ({ field: "status", message: s })) }
    );
  }
  return unique;
}

/**
 * Create a new survey sketch upload. Surveyor must be the authenticated user.
 * @param {Object} surveyor - Authenticated user (must h ave role SURVEYOR)
 * @param {Object} payload - Validated payload from schemas.surveyorSketchUploadCreate
 * @returns {Promise<Object>} Created document (with populated refs if needed)
 */
async function create(surveyor, payload) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can submit sketch uploads");
  }

  // Validate that district, taluka exist; hobli/village optional but validated when provided
  const [district, taluka] = await Promise.all([
    District.findById(payload.district).lean(),
    Taluka.findById(payload.taluka).lean(),
  ]);

  if (!district) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }
  if (!taluka) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }

  const talukaDistrictId = taluka.districtId?.toString ? taluka.districtId.toString() : String(taluka.districtId);
  const districtIdStr = String(payload.district);
  if (talukaDistrictId !== districtIdStr) {
    throw new BadRequestError("Taluka does not belong to the given district", {
      code: "TALUKA_DISTRICT_MISMATCH",
    });
  }

  let hobli = null;
  if (payload.hobli) {
    hobli = await Hobli.findById(payload.hobli).lean();
    if (!hobli) {
      throw new NotFoundError("Hobli not found", { code: "HOBLI_NOT_FOUND" });
    }
    const hobliTalukaId = hobli.talukaId?.toString ? hobli.talukaId.toString() : String(hobli.talukaId);
    const talukaIdStr = String(payload.taluka);
    if (hobliTalukaId !== talukaIdStr) {
      throw new BadRequestError("Hobli does not belong to the given taluka", {
        code: "HOBLI_TALUKA_MISMATCH",
      });
    }
  }

  let village = null;
  if (payload.village) {
    village = await Village.findById(payload.village).lean();
    if (!village) {
      throw new NotFoundError("Village not found", { code: "VILLAGE_NOT_FOUND" });
    }
    const villageTalukaId = village.talukaId?.toString ? village.talukaId.toString() : String(village.talukaId);
    const villageDistrictId = village.districtId?.toString ? village.districtId.toString() : String(village.districtId);
    if (villageTalukaId !== String(payload.taluka)) {
      throw new BadRequestError("Village does not belong to the given taluka", {
        code: "VILLAGE_TALUKA_MISMATCH",
      });
    }
    if (villageDistrictId !== districtIdStr) {
      throw new BadRequestError("Village does not belong to the given district", {
        code: "VILLAGE_DISTRICT_MISMATCH",
      });
    }
    if (payload.hobli) {
      const villageHobliId = village.hobliId?.toString ? village.hobliId.toString() : String(village.hobliId);
      if (villageHobliId !== String(payload.hobli)) {
        throw new BadRequestError("Village does not belong to the given hobli", {
          code: "VILLAGE_HOBLI_MISMATCH",
        });
      }
    }
  }

  const createDoc = () =>
    new SurveyorSketchUpload({
      surveyor: surveyor._id,
      surveyType: payload.surveyType,
      district: payload.district,
      taluka: payload.taluka,
      hobli: payload.hobli || null,
      village: payload.village || null,
      surveyNo: payload.surveyNo,
      documents: require("../utils/surveyDocuments").documentsMapFromObject(payload.documents),
      is_originaltippani: payload.is_originaltippani || false,
      is_hissatippani: payload.is_hissatippani || false,
      is_atlas: payload.is_atlas || false,
      is_rrpakkabook: payload.is_rrpakkabook || false,
      is_akarabandu: payload.is_akarabandu || false,
      is_kharabuttar: payload.is_kharabuttar || false,
      is_mulapatra: payload.is_mulapatra || false,
      audio: Array.isArray(payload.audio) ? payload.audio : [],
      other_documents: Array.isArray(payload.other_documents) ? payload.other_documents : [],
      singleUpload: Array.isArray(payload.singleUpload) ? payload.singleUpload : payload.singleUpload ? [payload.singleUpload] : [],
      others: payload.others ?? null,
    });

  async function cleanupDraftIfRequested() {
    if (!payload.draftId) return;
    await SurveyDraft.findOneAndUpdate(
      { _id: payload.draftId, surveyor: surveyor._id, deletedAt: null },
      { $set: { deletedAt: new Date() } }
    );
  }

  const MAX_RETRIES = 4;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const doc = createDoc();
    try {
      await doc.save();

      const phonePe = phonePeSketchPayment;
      const resolved = await sketchPaymentPricing.resolveSketchUploadFee(payload.amountPaise);
      const feePaise = resolved.feePaise;
      if (feePaise > 0) {
        if (!phonePe.isPhonePeConfigured()) {
          throw new BadRequestError("Sketch upload fee is configured but PhonePe is not configured.", {
            code: "PHONEPE_NOT_CONFIGURED",
          });
        }
        const merchantOrderId = `sketch_${doc._id}`;
        doc.status = SURVEY_SKETCH_STATUS.PAYMENT_PENDING;
        doc.sketchPayment = {
          status: "PENDING",
          merchantOrderId,
          amountPaise: feePaise,
          planAmountRupees: resolved.planAmountRupees,
          discountRupees: resolved.discountRupees,
        };
        await doc.save();
        let checkoutPageUrl;
        try {
          logger.info("PhonePe initiatePay sketch upload", {
            uploadId: String(doc._id),
            merchantOrderId,
            amountPaise: feePaise,
            payableRupees: feePaise / 100,
            pricingSource: resolved.source,
          });
          const pr = await phonePe.initiatePay(merchantOrderId, feePaise);
          checkoutPageUrl = pr.redirectUrl;
        } catch (pe) {
          logger.error("PhonePe initiatePay failed for sketch upload", pe, { uploadId: String(doc._id) });
          await SurveyorSketchUpload.findByIdAndUpdate(doc._id, { $set: { "sketchPayment.status": "FAILED" } });
          if (pe instanceof BadRequestError) throw pe;
          throw new BadRequestError(pe?.message || "Payment gateway error", { code: "PHONEPE_INIT_FAILED" });
        }
        await cleanupDraftIfRequested();
        const latestPaid = await SurveyorSketchUpload.findById(doc._id).lean();
        return {
          data: latestPaid || (doc.toJSON ? doc.toJSON() : doc),
          meta: {
            payment: {
              requiresPayment: true,
              checkoutPageUrl,
              redirectUrl: checkoutPageUrl,
              merchantOrderId,
              amountPaise: feePaise,
              planAmountRupees: resolved.planAmountRupees,
              discountRupees: resolved.discountRupees,
              payableRupees: resolved.payableRupees,
              pricingSource: resolved.source,
            },
          },
        };
      }

      await postSubmitNotifyAndAutoAssign(doc._id, surveyor);
      await cleanupDraftIfRequested();
      const latest = await SurveyorSketchUpload.findById(doc._id).lean();
      return {
        data: latest || (doc.toJSON ? doc.toJSON() : doc),
        meta: {
          payment: {
            requiresPayment: false,
            feePaise: 0,
            message:
              "No checkout URL: set SKETCH_UPLOAD_FEE_PAISE > 0 and PUBLIC_API_BASE_URL on the server to enable PhonePe for new uploads.",
          },
        },
      };
    } catch (err) {
      const isDuplicateApplicationId =
        err?.code === 11000 &&
        (err?.keyPattern?.applicationId || err?.keyValue?.applicationId || String(err?.message || "").includes("applicationId"));

      if (isDuplicateApplicationId && attempt < MAX_RETRIES) {
        // Retry with a fresh document so pre-save regenerates applicationId.
        continue;
      }

      // Handle Mongoose validation errors
      if (err.name === "ValidationError") {
        const errors = Object.values(err.errors || {}).map((e) => ({
          field: e.path,
          message: e.message,
        }));
        throw new BadRequestError("Validation failed", { code: "VALIDATION_ERROR", errors });
      }
      // Handle applicationId generation errors from pre-save hook
      if (err.message?.includes("applicationId") || err.message?.includes("District") || err.message?.includes("Taluka")) {
        throw new BadRequestError(err.message, { code: "APPLICATION_ID_GENERATION_FAILED" });
      }
      throw err;
    }
  }

  throw new BadRequestError("Failed to create survey sketch upload after retries", {
    code: "APPLICATION_ID_GENERATION_FAILED",
  });
}

/**
 * Get a single upload by ID. Surveyor can only access own; Admin/SuperAdmin can access any.
 * @param {Object} actor - Authenticated user
 * @param {string} uploadId - SurveyorSketchUpload _id
 * @returns {Promise<Object>}
 */
async function getById(actor, uploadId) {
  const doc = await SurveyorSketchUpload.findById(uploadId)
    .populate("surveyor", "name role")
    .populate("district", "code name")
    .populate("taluka", "code name")
    .populate("hobli", "code name")
    .populate("village", "code name")
    .lean();

  if (!doc) {
    throw new NotFoundError("Survey sketch upload not found");
  }

  if (actor.role === USER_ROLES.SURVEYOR) {
    const surveyorId = doc.surveyor?._id?.toString?.() ?? doc.surveyor?.toString?.();
    if (surveyorId !== actor._id.toString()) {
      throw new ForbiddenError("You can only view your own uploads");
    }
  } else if (actor.role !== USER_ROLES.SUPER_ADMIN && actor.role !== USER_ROLES.ADMIN) {
    throw new ForbiddenError("Insufficient permissions");
  }

  return doc;
}

/**
 * CAD: full sketch upload for an assignment they can work on (same shape as surveyor GET).
 */
async function getByIdForCad(actor, uploadId) {
  if (actor.role !== USER_ROLES.CAD) {
    throw new ForbiddenError("Only CAD users can use this endpoint");
  }

  const userCenterId = actor.cadProfile?.cadCenter != null ? actor.cadProfile.cadCenter : null;
  const orClauses = [{ assignedTo: actor._id }];
  if (userCenterId) {
    orClauses.push({ assignedTo: null, cadCenter: userCenterId });
  }

  const linked = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: { $ne: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED },
    $or: orClauses,
  })
    .select("_id")
    .lean();

  if (!linked) {
    throw new ForbiddenError("You do not have access to this sketch upload");
  }

  const doc = await SurveyorSketchUpload.findById(uploadId)
    .populate("surveyor", "name role")
    .populate("district", "code name")
    .populate("taluka", "code name")
    .populate("hobli", "code name")
    .populate("village", "code name")
    .lean();

  if (!doc) {
    throw new NotFoundError("Survey sketch upload not found");
  }

  return doc;
}

/**
 * List uploads. Surveyor: only own; Admin/SuperAdmin: all (optional filter by surveyor, status, cadCenterId).
 * cadCenterId: only uploads that are assigned to that CAD center (via SurveySketchAssignment).
 * @param {Object} actor - Authenticated user
 * @param {{ page?: number, limit?: number, status?: string, surveyorId?: string, cadCenterId?: string }} options
 * @returns {Promise<{ data: Array, meta: { page, limit, total } }>}
 */
async function list(actor, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const filter = {};

  if (actor.role === USER_ROLES.SURVEYOR) {
    filter.surveyor = actor._id;
  } else if (options.surveyorId) {
    filter.surveyor = options.surveyorId;
  }

  if (options.status) {
    filter.status = options.status;
  }

  if (options.cadCenterId) {
    const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
    const assignments = await SurveySketchAssignment.find({ cadCenter: options.cadCenterId })
      .select("surveyorSketchUpload")
      .lean();
    const uploadIds = assignments.map((a) => a.surveyorSketchUpload).filter(Boolean);
    filter._id = { $in: uploadIds };
  }

  const [data, total] = await Promise.all([
    SurveyorSketchUpload.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean(),
    SurveyorSketchUpload.countDocuments(filter),
  ]);

  return {
    data,
    meta: { page, limit, total },
  };
}

/**
 * List all survey sketch uploads with their assignment (if any). Admin only. No status filter – returns PENDING and ASSIGNED etc.
 * Each item has shape { ...upload, assignment: assignmentDoc | null }.
 */
async function listAllWithAssignment(options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const [uploads, total] = await Promise.all([
    SurveyorSketchUpload.find({})
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean(),
    SurveyorSketchUpload.countDocuments({}),
  ]);

  const uploadIds = uploads.map((u) => u._id);
  const assignments = await SurveySketchAssignment.find({
    surveyorSketchUpload: { $in: uploadIds },
  })
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();

  const listsByUpload = {};
  for (const a of assignments) {
    const id = a.surveyorSketchUpload?.toString?.() || String(a.surveyorSketchUpload);
    (listsByUpload[id] ||= []).push(a);
  }
  const assignmentByUploadId = {};
  for (const [uploadId, list] of Object.entries(listsByUpload)) {
    assignmentByUploadId[uploadId] = pickDisplayAssignmentForUpload(list);
  }

  const data = uploads.map((upload) => ({
    ...upload,
    assignment: assignmentByUploadId[upload._id.toString()] || null,
  }));

  return {
    data,
    meta: { page, limit, total },
  };
}

/**
 * Surveyor-facing order list with tab counts.
 * Buckets:
 * - all
 * - active: PAYMENT_PENDING, PENDING, ASSIGNED, CAD_DELIVERED, UNDER_REVISION
 * - completed: APPROVED
 * - cancelled: REJECTED
 */
async function listOrdersForSurveyor(actor, options = {}) {
  if (actor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can access orders");
  }

  const page = Math.max(1, parseInt(options.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;
  const bucket = String(options.bucket || SURVEYOR_ORDER_BUCKETS.ALL).toLowerCase().trim();
  const selectedBucket = Object.values(SURVEYOR_ORDER_BUCKETS).includes(bucket)
    ? bucket
    : SURVEYOR_ORDER_BUCKETS.ALL;
  const statusFilter = parseStatusFilter(options.status);

  await surveySketchAssignmentService.repairUploadStatusesForSurveyor(actor._id);

  const baseFilter = { surveyor: actor._id };
  const listFilter = { ...baseFilter };
  if (statusFilter?.length) {
    listFilter.status = statusFilter.length === 1 ? statusFilter[0] : { $in: statusFilter };
  } else if (selectedBucket !== SURVEYOR_ORDER_BUCKETS.ALL) {
    listFilter.status = { $in: ORDER_BUCKET_TO_STATUSES[selectedBucket] || [] };
  }

  const [data, total, byStatus] = await Promise.all([
    SurveyorSketchUpload.find(listFilter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean(),
    SurveyorSketchUpload.countDocuments(listFilter),
    SurveyorSketchUpload.aggregate([
      { $match: baseFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const uploadIds = data.map((u) => u._id);
  const assignments = uploadIds.length
    ? await SurveySketchAssignment.find({ surveyorSketchUpload: { $in: uploadIds } })
        .populate("assignedTo", "name auth")
        .populate("cadCenter", "name code")
        .populate("assignedBy", "name")
        .lean()
    : [];
  const listsByUpload = {};
  for (const a of assignments) {
    const id = a.surveyorSketchUpload?.toString?.() || String(a.surveyorSketchUpload);
    (listsByUpload[id] ||= []).push(a);
  }
  const enrichedData = data.map((upload) => ({
    ...upload,
    assignment: pickDisplayAssignmentForUpload(listsByUpload[upload._id.toString()] || []) || null,
  }));

  const statusCount = {};
  for (const s of Object.values(SURVEY_SKETCH_STATUS)) {
    statusCount[s] = 0;
  }
  byStatus.forEach((r) => {
    const key = r._id === "UNDER_REVIEW" ? SURVEY_SKETCH_STATUS.UNDER_REVISION : r._id;
    if (key && statusCount[key] !== undefined) {
      statusCount[key] += r.count;
    }
  });
  const activeCount = ORDER_BUCKET_TO_STATUSES[SURVEYOR_ORDER_BUCKETS.ACTIVE]
    .reduce((sum, s) => sum + (statusCount[s] || 0), 0);
  const completedCount = ORDER_BUCKET_TO_STATUSES[SURVEYOR_ORDER_BUCKETS.COMPLETED]
    .reduce((sum, s) => sum + (statusCount[s] || 0), 0);
  const cancelledCount = ORDER_BUCKET_TO_STATUSES[SURVEYOR_ORDER_BUCKETS.CANCELLED]
    .reduce((sum, s) => sum + (statusCount[s] || 0), 0);
  const allCount = Object.values(statusCount).reduce((sum, n) => sum + n, 0);

  return {
    data: enrichedData,
    meta: {
      page,
      limit,
      total,
      bucket: selectedBucket,
      ...(statusFilter?.length ? { status: statusFilter } : {}),
    },
    counts: {
      all: allCount,
      active: activeCount,
      completed: completedCount,
      cancelled: cancelledCount,
      byStatus: statusCount,
    },
  };
}

module.exports = {
  create,
  getById,
  getByIdForCad,
  list,
  listOrdersForSurveyor,
  listAllWithAssignment,
  completeSketchUploadAfterPayment,
  markSketchPaymentFailed,
  reinitiateSketchPayment,
  clearSketchUpload,
  sketchUploadMerchantOrderId,
  sketchUploadRetryMerchantOrderId,
};
