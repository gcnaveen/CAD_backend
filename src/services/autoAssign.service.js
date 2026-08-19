/**
 * Auto-assignment with persisted attempts, retry backoff, exception queue, and
 * manual override after timeout (audit M-09).
 */

const crypto = require("crypto");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const AutoAssignAttempt = require("../models/assignment/AutoAssignAttempt");
const { AUTO_ASSIGN_ATTEMPT_OUTCOME } = require("../models/assignment/AutoAssignAttempt");
const CadCenter = require("../models/masters/CadCenter");
const User = require("../models/user/User");
const flowService = require("./config/surveySketchAssignmentFlow.service");
const notificationService = require("./notification.service");
const logger = require("../utils/logger");
const { getCorrelationId } = require("../utils/requestContext");
const { ForbiddenError } = require("../utils/errors");
const { requireLoadedUpload } = require("./requireLoadedRecord");
const {
  USER_ROLES,
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
} = require("../config/constants");
const { assertSketchStatusTransition } = require("../config/lifecycleQcSpec");

const AUTO_ASSIGN_STATE = Object.freeze({
  IDLE: "IDLE",
  PENDING_RETRY: "PENDING_RETRY",
  IN_PROGRESS: "IN_PROGRESS",
  SUCCEEDED: "SUCCEEDED",
  EXCEPTION: "EXCEPTION",
});

const ACTIVE_ASSIGNMENT_STATUSES = [
  SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
  SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
];

function getMaxAttempts() {
  const n = parseInt(process.env.AUTO_ASSIGN_MAX_ATTEMPTS || "5", 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

function getRetryBaseMs() {
  const n = parseInt(process.env.AUTO_ASSIGN_RETRY_BASE_MS || "60000", 10);
  return Number.isFinite(n) && n > 0 ? n : 60000;
}

function getManualOverrideMs() {
  const n = parseInt(process.env.AUTO_ASSIGN_MANUAL_OVERRIDE_MS || String(15 * 60 * 1000), 10);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000;
}

function getAlertAfterAttempts() {
  const n = parseInt(process.env.AUTO_ASSIGN_ALERT_AFTER_ATTEMPTS || "2", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

function getLockTtlMs() {
  const n = parseInt(process.env.AUTO_ASSIGN_LOCK_TTL_MS || "120000", 10);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}

function getPolicy() {
  return {
    maxAttempts: getMaxAttempts(),
    retryBaseMs: getRetryBaseMs(),
    manualOverrideMs: getManualOverrideMs(),
    alertAfterAttempts: getAlertAfterAttempts(),
    lockTtlMs: getLockTtlMs(),
  };
}

function computeNextRetryAt(attemptCount) {
  const base = getRetryBaseMs();
  const exp = Math.min(6, Math.max(0, attemptCount - 1));
  const delay = base * Math.pow(2, exp);
  return new Date(Date.now() + delay);
}

async function recordAttempt(fields) {
  try {
    await AutoAssignAttempt.create({
      ...fields,
      correlationId: getCorrelationId(),
    });
  } catch (err) {
    logger.error("autoAssign attempt write failed", err, {
      uploadId: String(fields.surveyorSketchUpload),
    });
  }
}

async function pickCadCenterForAutoAssign() {
  const loadStatuses = [
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
  ];

  const rows = await CadCenter.aggregate([
    {
      $match: {
        deletedAt: null,
        status: "ACTIVE",
        availabilityStatus: { $in: ["AVAILABLE", "BUSY"] },
      },
    },
    {
      $lookup: {
        from: "surveysketchassignments",
        let: { centerId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: { $eq: ["$cadCenter", "$$centerId"] },
              status: { $in: loadStatuses },
            },
          },
          { $count: "count" },
        ],
        as: "activeWork",
      },
    },
    {
      $addFields: {
        currentLoad: { $ifNull: [{ $arrayElemAt: ["$activeWork.count", 0] }, 0] },
        availabilityRank: {
          $cond: [{ $eq: ["$availabilityStatus", "AVAILABLE"] }, 0, 1],
        },
      },
    },
    { $sort: { availabilityRank: 1, currentLoad: 1, createdAt: 1, _id: 1 } },
    { $limit: 1 },
    { $project: { _id: 1 } },
  ]);

  return rows?.[0]?._id || null;
}

function isManualOverrideAllowed(meta, now = new Date()) {
  if (!meta) return false;
  if (meta.state === AUTO_ASSIGN_STATE.EXCEPTION) return true;
  if (meta.manualOverrideAllowedAt && new Date(meta.manualOverrideAllowedAt) <= now) return true;
  return false;
}

/**
 * Whether admin UI may show manual assign for this upload.
 */
async function getManualAssignGate(uploadDoc) {
  const flow = await flowService.getAutoAssignState();
  const meta = uploadDoc?.autoAssignMeta || {};
  const active = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadDoc._id,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  })
    .select("_id")
    .lean();

  if (active) {
    return {
      allowed: false,
      reason: "ALREADY_ASSIGNED",
      autoAssignEnabled: flow.enabled,
      autoAssignState: meta.state || AUTO_ASSIGN_STATE.SUCCEEDED,
      manualOverrideAllowedAt: meta.manualOverrideAllowedAt || null,
      activeAssignmentId: String(active._id),
    };
  }

  if (!flow.enabled) {
    return {
      allowed: true,
      reason: "AUTO_ASSIGN_OFF",
      autoAssignEnabled: false,
      autoAssignState: meta.state || AUTO_ASSIGN_STATE.IDLE,
      manualOverrideAllowedAt: null,
      activeAssignmentId: null,
    };
  }

  if (isManualOverrideAllowed(meta)) {
    return {
      allowed: true,
      reason: meta.state === AUTO_ASSIGN_STATE.EXCEPTION ? "EXCEPTION_QUEUE" : "OVERRIDE_TIMEOUT",
      autoAssignEnabled: true,
      autoAssignState: meta.state || AUTO_ASSIGN_STATE.PENDING_RETRY,
      manualOverrideAllowedAt: meta.manualOverrideAllowedAt || null,
      activeAssignmentId: null,
    };
  }

  return {
    allowed: false,
    reason: "AUTO_ASSIGN_ACTIVE",
    autoAssignEnabled: true,
    autoAssignState: meta.state || AUTO_ASSIGN_STATE.PENDING_RETRY,
    manualOverrideAllowedAt: meta.manualOverrideAllowedAt || null,
    activeAssignmentId: null,
  };
}

async function assertManualAssignAllowed(uploadDoc) {
  const gate = await getManualAssignGate(uploadDoc);
  if (!gate.allowed) {
    throw new ForbiddenError(
      gate.reason === "ALREADY_ASSIGNED"
        ? "Sketch already has an active assignment"
        : "Manual assignment is blocked while auto-assignment is active. Wait for the override window or exception queue.",
      {
        code: gate.reason === "ALREADY_ASSIGNED" ? "ALREADY_ASSIGNED" : "MANUAL_ASSIGN_BLOCKED",
        errors: [gate],
      }
    );
  }
  return gate;
}

async function emitOpsAlert({ uploadId, failureCode, failureReason, attemptCount, state }) {
  logger.warn("ALERT_AUTO_ASSIGN_FAILURE", {
    alertType: "AUTO_ASSIGN_FAILURE",
    severity: state === AUTO_ASSIGN_STATE.EXCEPTION ? "high" : "medium",
    uploadId: String(uploadId),
    failureCode,
    failureReason,
    attemptCount,
    state,
    escalateTo: "operations",
  });

  try {
    await notificationService.create({
      type: "AUTO_ASSIGN_EXCEPTION",
      title:
        state === AUTO_ASSIGN_STATE.EXCEPTION
          ? "Auto-assign exception queue"
          : "Auto-assign failure",
      message: failureReason || failureCode || "Auto-assignment failed",
      entityType: "SurveyorSketchUpload",
      entityId: uploadId,
      targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN],
      data: { failureCode, attemptCount, state },
    });
  } catch (err) {
    logger.error("Failed to notify ops of auto-assign failure", err, { uploadId: String(uploadId) });
  }
}

/**
 * Seed retry metadata when a sketch enters PENDING under auto-assign.
 */
async function enqueueAutoAssign(uploadId, { actorUserId = null } = {}) {
  const flow = await flowService.getAutoAssignState();
  if (!flow.enabled) return null;

  const now = new Date();
  const overrideAt = new Date(now.getTime() + getManualOverrideMs());
  await SurveyorSketchUpload.findOneAndUpdate(
    {
      _id: uploadId,
      status: SURVEY_SKETCH_STATUS.PENDING,
      "autoAssignMeta.state": { $nin: [AUTO_ASSIGN_STATE.SUCCEEDED, AUTO_ASSIGN_STATE.IN_PROGRESS] },
    },
    {
      $set: {
        "autoAssignMeta.state": AUTO_ASSIGN_STATE.PENDING_RETRY,
        "autoAssignMeta.nextRetryAt": now,
        "autoAssignMeta.manualOverrideAllowedAt": overrideAt,
        "autoAssignMeta.lastFailureCode": null,
        "autoAssignMeta.lastFailureReason": null,
      },
    },
    { new: true }
  );

  return tryAutoAssign(uploadId, {
    source: "SUBMIT",
    actorUserId: flow.updatedBy || actorUserId,
  });
}

async function markFailure(uploadId, { attemptNo, failureCode, failureReason, source, actorUserId }) {
  const max = getMaxAttempts();
  const toException = attemptNo >= max;
  const nextState = toException ? AUTO_ASSIGN_STATE.EXCEPTION : AUTO_ASSIGN_STATE.PENDING_RETRY;
  const nextRetryAt = toException ? null : computeNextRetryAt(attemptNo);

  await SurveyorSketchUpload.updateOne(
    { _id: uploadId },
    {
      $set: {
        "autoAssignMeta.state": nextState,
        "autoAssignMeta.attemptCount": attemptNo,
        "autoAssignMeta.lastAttemptAt": new Date(),
        "autoAssignMeta.lastFailureCode": failureCode,
        "autoAssignMeta.lastFailureReason": String(failureReason || "").slice(0, 500),
        "autoAssignMeta.nextRetryAt": nextRetryAt,
        "autoAssignMeta.lockToken": null,
        "autoAssignMeta.lockUntil": null,
        ...(toException ? { "autoAssignMeta.exceptionQueuedAt": new Date() } : {}),
      },
    }
  );

  await recordAttempt({
    surveyorSketchUpload: uploadId,
    attemptNo,
    source,
    outcome: AUTO_ASSIGN_ATTEMPT_OUTCOME.FAILURE,
    failureCode,
    failureReason,
    actorUserId,
  });

  if (attemptNo >= getAlertAfterAttempts() || toException) {
    await emitOpsAlert({
      uploadId,
      failureCode,
      failureReason,
      attemptCount: attemptNo,
      state: nextState,
    });
  }

  return { state: nextState, nextRetryAt, attemptNo };
}

async function markSuccess(uploadId, { attemptNo, assignmentId, cadCenterId, source, actorUserId }) {
  await SurveyorSketchUpload.updateOne(
    { _id: uploadId },
    {
      $set: {
        "autoAssignMeta.state": AUTO_ASSIGN_STATE.SUCCEEDED,
        "autoAssignMeta.attemptCount": attemptNo,
        "autoAssignMeta.lastAttemptAt": new Date(),
        "autoAssignMeta.lastFailureCode": null,
        "autoAssignMeta.lastFailureReason": null,
        "autoAssignMeta.nextRetryAt": null,
        "autoAssignMeta.lockToken": null,
        "autoAssignMeta.lockUntil": null,
        "autoAssignMeta.succeededAt": new Date(),
        "autoAssignMeta.assignmentId": assignmentId,
        "autoAssignMeta.exceptionQueuedAt": null,
      },
    }
  );

  await recordAttempt({
    surveyorSketchUpload: uploadId,
    attemptNo,
    source,
    outcome: AUTO_ASSIGN_ATTEMPT_OUTCOME.SUCCESS,
    cadCenterId,
    assignmentId,
    actorUserId,
  });
}

/**
 * Idempotent auto-assign attempt with lock.
 */
async function tryAutoAssign(uploadId, { source = "RETRY_JOB", actorUserId = null } = {}) {
  const flow = await flowService.getAutoAssignState();
  if (!flow.enabled && source !== "MANUAL_RETRY") {
    return { ok: false, code: "AUTO_ASSIGN_DISABLED" };
  }

  const assignedById = actorUserId || flow.updatedBy;
  if (!assignedById) {
    return markFailure(uploadId, {
      attemptNo: 1,
      failureCode: "NO_ASSIGNER",
      failureReason: "Auto-assign enabled but no updatedBy admin to attribute assignment",
      source,
      actorUserId: null,
    });
  }

  const existing = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  }).lean();
  if (existing) {
    await markSuccess(uploadId, {
      attemptNo: 1,
      assignmentId: existing._id,
      cadCenterId: existing.cadCenter,
      source,
      actorUserId: assignedById,
    });
    return { ok: true, assignment: existing, duplicatePrevented: true };
  }

  const lockToken = crypto.randomBytes(12).toString("hex");
  const lockUntil = new Date(Date.now() + getLockTtlMs());
  const now = new Date();

  const locked = await SurveyorSketchUpload.findOneAndUpdate(
    {
      _id: uploadId,
      status: SURVEY_SKETCH_STATUS.PENDING,
      $or: [
        { "autoAssignMeta.state": { $in: [AUTO_ASSIGN_STATE.PENDING_RETRY, AUTO_ASSIGN_STATE.EXCEPTION, AUTO_ASSIGN_STATE.IDLE, null] } },
        { "autoAssignMeta.lockUntil": { $lte: now } },
        { "autoAssignMeta.lockUntil": null },
        { autoAssignMeta: { $exists: false } },
      ],
    },
    {
      $set: {
        "autoAssignMeta.state": AUTO_ASSIGN_STATE.IN_PROGRESS,
        "autoAssignMeta.lockToken": lockToken,
        "autoAssignMeta.lockUntil": lockUntil,
        "autoAssignMeta.lastAttemptAt": now,
      },
      $inc: { "autoAssignMeta.attemptCount": 1 },
    },
    { new: true }
  ).select("_id status sketchPayment autoAssignMeta");

  if (!locked) {
    await recordAttempt({
      surveyorSketchUpload: uploadId,
      attemptNo: 0,
      source,
      outcome: AUTO_ASSIGN_ATTEMPT_OUTCOME.SKIPPED,
      failureCode: "LOCK_NOT_ACQUIRED",
      failureReason: "Another worker holds the assign lock or sketch not PENDING",
      actorUserId: assignedById,
    });
    return { ok: false, code: "LOCK_NOT_ACQUIRED" };
  }

  try {
    const { assertSketchBookingPaymentAllowsWorkflow } = require("./sketchPaymentGate.service");
    assertSketchBookingPaymentAllowsWorkflow(locked, { action: "auto_assign" });
  } catch (gateErr) {
    await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
      $set: {
        "autoAssignMeta.state": AUTO_ASSIGN_STATE.EXCEPTION,
        "autoAssignMeta.lockToken": null,
        "autoAssignMeta.lockUntil": null,
      },
    });
    return markFailure(uploadId, {
      attemptNo: Number(locked.autoAssignMeta?.attemptCount || 1),
      failureCode: gateErr.code || "SKETCH_PAYMENT_PENDING",
      failureReason: gateErr.message || "Booking payment not completed",
      source,
      actorUserId: assignedById,
    });
  }

  const attemptNo = Number(locked.autoAssignMeta?.attemptCount || 1);

  // Re-check active assignment under lock (idempotent)
  const race = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  }).lean();
  if (race) {
    await markSuccess(uploadId, {
      attemptNo,
      assignmentId: race._id,
      cadCenterId: race.cadCenter,
      source,
      actorUserId: assignedById,
    });
    return { ok: true, assignment: race, duplicatePrevented: true };
  }

  const assignedBy = await User.findById(assignedById).select("_id role").lean();
  if (!assignedBy) {
    return markFailure(uploadId, {
      attemptNo,
      failureCode: "ASSIGNER_NOT_FOUND",
      failureReason: "Configured auto-assign actor user not found",
      source,
      actorUserId: assignedById,
    });
  }

  let cadCenterId;
  try {
    cadCenterId = await pickCadCenterForAutoAssign();
  } catch (err) {
    logger.error("pickCadCenterForAutoAssign failed", err, { uploadId: String(uploadId) });
    return markFailure(uploadId, {
      attemptNo,
      failureCode: "PICK_CENTER_ERROR",
      failureReason: err.message || "Capacity pick failed",
      source,
      actorUserId: assignedById,
    });
  }

  if (!cadCenterId) {
    return markFailure(uploadId, {
      attemptNo,
      failureCode: "NO_CAPACITY",
      failureReason: "No AVAILABLE/BUSY CAD center with capacity for auto-assign",
      source,
      actorUserId: assignedById,
    });
  }

  try {
    const doc = new SurveySketchAssignment({
      surveyorSketchUpload: uploadId,
      cadCenter: cadCenterId,
      assignedTo: null,
      status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
      assignedBy: assignedBy._id,
      notes: "auto-assign",
    });
    const slaDue = require("./slaDue.service");
    slaDue.applySlaOnAssign(doc);
    await doc.save();

    const sketchAuto = await SurveyorSketchUpload.findById(uploadId).select("status");
    requireLoadedUpload(sketchAuto);
    assertSketchStatusTransition(sketchAuto.status, SURVEY_SKETCH_STATUS.ASSIGNED);
    sketchAuto.status = SURVEY_SKETCH_STATUS.ASSIGNED;
    await sketchAuto.save();

    await markSuccess(uploadId, {
      attemptNo,
      assignmentId: doc._id,
      cadCenterId,
      source,
      actorUserId: assignedById,
    });

    const populated = await SurveySketchAssignment.findById(doc._id)
      .populate("surveyorSketchUpload", "applicationId surveyNo status")
      .populate("cadCenter", "name code availabilityStatus")
      .populate("assignedBy", "name")
      .lean();

    try {
      await notificationService.create({
        type: "SURVEY_SKETCH_AUTO_ASSIGNED",
        title: "Survey sketch auto-assigned",
        message: "A new survey sketch was automatically assigned to a CAD center.",
        entityType: "SurveySketchAssignment",
        entityId: doc._id,
        targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CAD],
        createdBy: assignedBy._id,
        data: { cadCenterId: String(cadCenterId), source },
      });
    } catch (notifyErr) {
      logger.error("auto-assign success notification failed", notifyErr, { uploadId: String(uploadId) });
    }

    return { ok: true, assignment: populated || doc };
  } catch (err) {
    // Duplicate key / concurrent create → treat as success if active exists
    const again = await SurveySketchAssignment.findOne({
      surveyorSketchUpload: uploadId,
      status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
    }).lean();
    if (again) {
      await markSuccess(uploadId, {
        attemptNo,
        assignmentId: again._id,
        cadCenterId: again.cadCenter,
        source,
        actorUserId: assignedById,
      });
      return { ok: true, assignment: again, duplicatePrevented: true };
    }

    logger.error("auto-assign create failed", err, { uploadId: String(uploadId) });
    return markFailure(uploadId, {
      attemptNo,
      failureCode: err.code || "ASSIGN_CREATE_FAILED",
      failureReason: err.message || "Failed to create assignment",
      source,
      actorUserId: assignedById,
    });
  }
}

/**
 * Scheduled: retry PENDING_RETRY due, and keep EXCEPTION visible.
 */
async function processAutoAssignRetries({ limit = 40 } = {}) {
  const now = new Date();
  const due = await SurveyorSketchUpload.find({
    status: SURVEY_SKETCH_STATUS.PENDING,
    "autoAssignMeta.state": AUTO_ASSIGN_STATE.PENDING_RETRY,
    $or: [{ "autoAssignMeta.nextRetryAt": { $lte: now } }, { "autoAssignMeta.nextRetryAt": null }],
  })
    .select("_id")
    .sort({ "autoAssignMeta.nextRetryAt": 1 })
    .limit(limit)
    .lean();

  const results = [];
  for (const row of due) {
    results.push(await tryAutoAssign(row._id, { source: "RETRY_JOB" }));
  }

  const exceptionCount = await SurveyorSketchUpload.countDocuments({
    status: SURVEY_SKETCH_STATUS.PENDING,
    "autoAssignMeta.state": AUTO_ASSIGN_STATE.EXCEPTION,
  });

  if (exceptionCount > 0) {
    logger.warn("ALERT_AUTO_ASSIGN_EXCEPTION_QUEUE", {
      alertType: "AUTO_ASSIGN_EXCEPTION_QUEUE",
      severity: "high",
      exceptionCount,
      escalateTo: "operations",
    });
  }

  return { retried: results.length, exceptionCount, results };
}

async function listExceptionQueue({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const filter = {
    status: SURVEY_SKETCH_STATUS.PENDING,
    "autoAssignMeta.state": {
      $in: [AUTO_ASSIGN_STATE.EXCEPTION, AUTO_ASSIGN_STATE.PENDING_RETRY],
    },
  };
  const [data, total] = await Promise.all([
    SurveyorSketchUpload.find(filter)
      .select("applicationId surveyNo status autoAssignMeta surveyor createdAt")
      .populate("surveyor", "name auth.email")
      .sort({ "autoAssignMeta.exceptionQueuedAt": -1, "autoAssignMeta.nextRetryAt": 1 })
      .skip((p - 1) * lim)
      .limit(lim)
      .lean(),
    SurveyorSketchUpload.countDocuments(filter),
  ]);

  const now = new Date();
  return {
    data: data.map((d) => ({
      ...d,
      manualOverrideAllowed: isManualOverrideAllowed(d.autoAssignMeta, now),
    })),
    total,
    page: p,
    limit: lim,
    policy: getPolicy(),
  };
}

async function listAttemptsForUpload(uploadId, { limit = 50 } = {}) {
  return AutoAssignAttempt.find({ surveyorSketchUpload: uploadId })
    .sort({ createdAt: -1 })
    .limit(Math.min(100, limit))
    .lean();
}

/**
 * Clear exception / meta after successful manual assignment.
 */
async function markManualAssignSucceeded(uploadId, assignmentId, actorUserId) {
  const upload = await SurveyorSketchUpload.findById(uploadId).select("autoAssignMeta");
  const attemptNo = Number(upload?.autoAssignMeta?.attemptCount || 0) + 1;
  await SurveyorSketchUpload.updateOne(
    { _id: uploadId },
    {
      $set: {
        "autoAssignMeta.state": AUTO_ASSIGN_STATE.SUCCEEDED,
        "autoAssignMeta.succeededAt": new Date(),
        "autoAssignMeta.assignmentId": assignmentId,
        "autoAssignMeta.exceptionQueuedAt": null,
        "autoAssignMeta.nextRetryAt": null,
        "autoAssignMeta.lockToken": null,
        "autoAssignMeta.lockUntil": null,
        "autoAssignMeta.lastFailureCode": null,
        "autoAssignMeta.lastFailureReason": null,
      },
    }
  );
  await recordAttempt({
    surveyorSketchUpload: uploadId,
    attemptNo,
    source: "MANUAL_ASSIGN",
    outcome: AUTO_ASSIGN_ATTEMPT_OUTCOME.SUCCESS,
    assignmentId,
    actorUserId,
  });
}

module.exports = {
  AUTO_ASSIGN_STATE,
  getPolicy,
  getManualAssignGate,
  assertManualAssignAllowed,
  isManualOverrideAllowed,
  enqueueAutoAssign,
  tryAutoAssign,
  processAutoAssignRetries,
  listExceptionQueue,
  listAttemptsForUpload,
  markManualAssignSucceeded,
  pickCadCenterForAutoAssign,
};
