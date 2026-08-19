/**
 * Survey Sketch Assignment service – assign survey sketches to CAD centers (admin).
 * Production: validate sketch and center exist, enforce one active assignment per sketch (optional), audit trail.
 */

const SurveySketchAssignment = require("../../models/assignment/SurveySketchAssignment");
const SurveyorSketchUpload = require("../../models/surveyor/SurveyorSketchUpload");
const CadCenter = require("../../models/masters/CadCenter");
const User = require("../../models/user/User");
const notificationService = require("../notification.service");
const logger = require("../../utils/logger");
const {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} = require("../../utils/errors");
const {
  USER_ROLES,
  USER_STATUS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
  SURVEY_SKETCH_STATUS,
  CAD_WALLET_ENTRY_KIND,
} = require("../../config/constants");
const {
  assertSketchBookingPaymentAllowsWorkflow,
} = require("../sketchPaymentGate.service");
const {
  applySketchStatus,
  applyAssignmentStatus,
  assertSketchStatusTransition,
  assertAssignmentStatusTransition,
  assertQcRequiredForRelease,
  ORDER_TYPES,
} = require("../../config/lifecycleQcSpec");
const {
  requireLoadedUpload,
} = require("../requireLoadedRecord");
const slaDue = require("../slaDue.service");
const sketchPaymentPricing = require("../sketchPaymentPricing.service");
const phonePeSketchPayment = require("../phonePeSketchPayment.service");
const paymentAttempt = require("../paymentAttempt.service");
const cadWalletService = require("../cadWallet.service");
const { normalizeStoredDocumentList } = require("../../utils/surveyDocuments");
const { mongoRoleEquals, mongoStatusEquals } = require("../../utils/roleNormalize");

// CAD must accept within this window after assignment; otherwise it is auto-rejected.
const AUTO_REJECT_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours
const ACTIVE_ASSIGNMENT_STATUSES = [
  SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
  SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
];

/** Keep upload.status in sync when an active assignment exists (fixes stale PENDING after admin assign). */
async function syncUploadStatusWithActiveAssignment(uploadId) {
  if (!uploadId) return;
  const upload = await SurveyorSketchUpload.findById(uploadId).select("status").lean();
  if (!upload) return;
  if (
    upload.status === SURVEY_SKETCH_STATUS.PAYMENT_PENDING ||
    upload.status === SURVEY_SKETCH_STATUS.APPROVED ||
    upload.status === SURVEY_SKETCH_STATUS.REJECTED
  ) {
    return;
  }

  const active = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  })
    .select("_id")
    .lean();
  if (!active) return;

  if (
    upload.status === SURVEY_SKETCH_STATUS.PENDING ||
    upload.status === SURVEY_SKETCH_STATUS.UNDER_REVISION
  ) {
    assertSketchStatusTransition(upload.status, SURVEY_SKETCH_STATUS.ASSIGNED);
    await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
      status: SURVEY_SKETCH_STATUS.ASSIGNED,
    });
  }
}

/** Repair uploads for one surveyor that have active assignments but stale workflow status. */
async function repairUploadStatusesForSurveyor(surveyorId) {
  const uploadIds = await SurveySketchAssignment.distinct("surveyorSketchUpload", {
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  });
  if (!uploadIds.length) return;
  assertSketchStatusTransition(SURVEY_SKETCH_STATUS.PENDING, SURVEY_SKETCH_STATUS.ASSIGNED);
  assertSketchStatusTransition(SURVEY_SKETCH_STATUS.UNDER_REVISION, SURVEY_SKETCH_STATUS.ASSIGNED);
  await SurveyorSketchUpload.updateMany(
    {
      _id: { $in: uploadIds },
      surveyor: surveyorId,
      status: { $in: [SURVEY_SKETCH_STATUS.PENDING, SURVEY_SKETCH_STATUS.UNDER_REVISION] },
    },
    { $set: { status: SURVEY_SKETCH_STATUS.ASSIGNED } }
  );
}

function idFromRef(ref) {
  if (ref == null) return null;
  return ref._id != null ? ref._id : ref;
}

/**
 * CAD users to include in assignment notification targetUsers (never CadCenter fan-out).
 * Only the assigned CAD gets user-targeted notifications; legacy pool (no assignee) → admins only.
 */
function getNotificationCadUserIds(assignmentDoc) {
  const assignedId = idFromRef(assignmentDoc?.assignedTo);
  return assignedId ? [assignedId] : [];
}

/** N3 / GUARD-01: load upload or throw — never skip payment/status gates. */
async function loadUploadOrThrow(uploadId, select) {
  if (!uploadId) requireLoadedUpload(null);
  let q = SurveyorSketchUpload.findById(uploadId);
  if (select) q = q.select(select);
  const upload = await q;
  return requireLoadedUpload(upload);
}

async function assertPaymentGateForUploadId(uploadId, action) {
  const upload = await loadUploadOrThrow(uploadId, "status sketchPayment");
  assertSketchBookingPaymentAllowsWorkflow(upload, { action });
  return upload;
}

async function notifyAssignmentEvent({
  type,
  title,
  message,
  assignmentDoc,
  createdBy,
  extraTargetUsers = [],
}) {
  try {
    const sketch = assignmentDoc?.surveyorSketchUpload
      ? await SurveyorSketchUpload.findById(assignmentDoc.surveyorSketchUpload).select("_id surveyor surveyNo status applicationId").lean()
      : null;
    const cadUserIds = getNotificationCadUserIds(assignmentDoc);
    const targetUsers = [
      ...(sketch?.surveyor ? [sketch.surveyor] : []),
      ...cadUserIds,
      ...extraTargetUsers,
    ];

    await notificationService.create({
      type,
      title,
      message,
      entityType: "SurveySketchAssignment",
      entityId: assignmentDoc?._id,
      targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN],
      targetUsers,
      createdBy: createdBy || null,
      data: {
        assignmentStatus: assignmentDoc?.status,
        cadCenter: assignmentDoc?.cadCenter || null,
        surveyNo: sketch?.surveyNo || null,
        applicationId: sketch?.applicationId || null,
      },
    });
  } catch (err) {
    logger.error("Failed to create assignment notification", err, {
      assignmentId: String(assignmentDoc?._id || ""),
      type,
    });
  }
}

/**
 * Create an assignment: survey sketch → CAD user (preferred) and/or CAD center (legacy pool).
 * Admin only. Require at least one of cadCenterId or assignedCadUserId.
 * If assignedCadUserId is set, cadCenterId is ignored (no CadCenter lookup).
 * If only cadCenterId is set and no CadCenter matches, the id is tried as a CAD user ObjectId (common client mix-up).
 */
async function create(payload, assignedBy) {
  const { surveyorSketchUploadId, cadCenterId, assignedCadUserId, dueDate, notes } = payload;

  if (!cadCenterId && !assignedCadUserId) {
    throw new BadRequestError("Either cadCenterId or assignedCadUserId is required", {
      code: "ASSIGNMENT_TARGET_REQUIRED",
    });
  }

  const sketch = await SurveyorSketchUpload.findById(surveyorSketchUploadId);
  if (!sketch) {
    throw new NotFoundError("Survey sketch upload not found", {
      code: "SURVEY_SKETCH_NOT_FOUND",
    });
  }
  assertSketchBookingPaymentAllowsWorkflow(sketch, { action: "assign" });

  const autoAssign = require("../autoAssign.service");
  // Manual assign gate when auto-assign is on (M-09): allow after timeout / exception.
  // Revisions always allowed through existing UNDER_REVISION path below.
  if (sketch.status !== SURVEY_SKETCH_STATUS.UNDER_REVISION) {
    await autoAssign.assertManualAssignAllowed(sketch);
  }

  let cadCenterToStore = null;
  let initialAssignedTo = null;

  if (assignedCadUserId) {
    const cadUser = await User.findOne({
      _id: assignedCadUserId,
      ...mongoRoleEquals(USER_ROLES.CAD),
      ...mongoStatusEquals(USER_STATUS.ACTIVE),
      deletedAt: null,
    }).lean();
    if (!cadUser) {
      throw new BadRequestError("assignedCadUserId must be an active CAD user", {
        code: "INVALID_ASSIGNED_CAD_USER",
      });
    }
    initialAssignedTo = cadUser._id;
    cadCenterToStore = null;
  } else if (cadCenterId) {
    const center = await CadCenter.findOne({ _id: cadCenterId, deletedAt: null }).lean();
    if (center) {
      cadCenterToStore = center._id;
    } else {
      const cadUser = await User.findOne({
        _id: cadCenterId,
        ...mongoRoleEquals(USER_ROLES.CAD),
        ...mongoStatusEquals(USER_STATUS.ACTIVE),
        deletedAt: null,
      }).lean();
      if (cadUser) {
        initialAssignedTo = cadUser._id;
        cadCenterToStore = null;
      } else {
        throw new NotFoundError(
          "No CAD center with this id, and it is not an active CAD user. Prefer assignedCadUserId with the CAD user's ObjectId.",
          { code: "ASSIGNMENT_TARGET_NOT_FOUND" }
        );
      }
    }
  }

  const existing = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: surveyorSketchUploadId,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  });

  if (existing) {
    const isUnderRevision = sketch.status === SURVEY_SKETCH_STATUS.UNDER_REVISION;

    // Rule: if sketch is UNDER_REVISION, admin/super-admin can always reassign.
    if (isUnderRevision) {
      // If current active assignment is still ASSIGNED, reuse it and retarget.
      if (existing.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED) {
        existing.assignedTo = initialAssignedTo || null;
        existing.cadCenter = cadCenterToStore || null;
        existing.assignedBy = assignedBy._id;
        existing.notes = notes ? String(notes).trim().slice(0, 1000) : existing.notes || null;
        slaDue.applySlaOnAssign(existing);
        await existing.save();
        await syncUploadStatusWithActiveAssignment(surveyorSketchUploadId);

        const reassigned = await SurveySketchAssignment.findById(existing._id)
          .populate("surveyorSketchUpload", "applicationId surveyNo status")
          .populate("cadCenter", "name code")
          .populate("assignedTo", "name auth")
          .populate("assignedBy", "name")
          .lean();

        await notifyAssignmentEvent({
          type: "SURVEY_SKETCH_ASSIGNED",
          title: "Survey sketch reassigned",
          message: initialAssignedTo
            ? "Revision assignment was reassigned to a CAD user."
            : "Revision assignment was reassigned to a CAD center.",
          assignmentDoc: reassigned || existing,
          createdBy: assignedBy?._id,
        });

        return slaDue.decorateAssignment(reassigned);
      }

      // If current active assignment already moved forward (IN_PROGRESS/ON_HOLD),
      // close it and create a fresh reassignment.
      applyAssignmentStatus(existing, SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED);
      await existing.save();
    }

    if (!isUnderRevision) {
      throw new ConflictError(
        "This survey sketch already has an active assignment. If CAD rejected, wait until that assignment is CANCELLED and the sketch is PENDING, then POST again with the same surveyorSketchUploadId and a new assignedCadUserId. Or PATCH the assignment: set status CANCELLED, or change assignedCadUserId while status is ASSIGNED.",
        { code: "ALREADY_ASSIGNED", assignmentId: existing._id }
      );
    }
  }

  const doc = new SurveySketchAssignment({
    surveyorSketchUpload: surveyorSketchUploadId,
    cadCenter: cadCenterToStore,
    assignedTo: initialAssignedTo,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedBy: assignedBy._id,
    notes: notes ? String(notes).trim().slice(0, 1000) : null,
  });
  // M-10: server-owned dueAt — ignore client dueDate
  slaDue.applySlaOnAssign(doc);
  await doc.save();

  const sketchForAssign = await loadUploadOrThrow(surveyorSketchUploadId, "status");
  assertSketchStatusTransition(sketchForAssign.status, SURVEY_SKETCH_STATUS.ASSIGNED);
  sketchForAssign.status = SURVEY_SKETCH_STATUS.ASSIGNED;
  await sketchForAssign.save();

  await autoAssign.markManualAssignSucceeded(surveyorSketchUploadId, doc._id, assignedBy._id);

  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();

  await notifyAssignmentEvent({
    type: "SURVEY_SKETCH_ASSIGNED",
    title: "Survey sketch assigned",
    message: initialAssignedTo
      ? "A survey sketch has been assigned to a CAD user."
      : "A survey sketch has been assigned to a CAD center.",
    assignmentDoc: populated || doc,
    createdBy: assignedBy?._id,
  });

  return slaDue.decorateAssignment(populated);
}

/**
 * List assignments for a CAD center (with optional status filter).
 */
async function listByCadCenter(cadCenterId, options = {}) {
  const filter = { cadCenter: cadCenterId };
  if (options.status) {
    filter.status = options.status;
  } else {
    filter.status = { $ne: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED };
  }

  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = Math.max(0, (parseInt(options.page, 10) || 1) - 1) * limit;

  const [data, total] = await Promise.all([
    SurveySketchAssignment.find(filter)
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyorSketchUpload", "applicationId surveyNo status district taluka village createdAt")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean(),
    SurveySketchAssignment.countDocuments(filter),
  ]);

  return {
    data: slaDue.sortBySlaRisk(slaDue.decorateAssignmentList(data)),
    total,
    slaPolicy: slaDue.getPolicy(),
  };
}
async function getAssignmentCountsByCenter(cadCenterId) {
  const byStatus = await SurveySketchAssignment.aggregate([
    { $match: { cadCenter: cadCenterId, status: { $ne: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const result = { total: 0, byStatus: {} };
  byStatus.forEach((r) => {
    result.byStatus[r._id] = r.count;
    result.total += r.count;
  });
  return result;
}

/**
 * Get single assignment by ID.
 */
async function getById(assignmentId) {
  const doc = await SurveySketchAssignment.findById(assignmentId)
    .populate("surveyorSketchUpload", "applicationId surveyNo status documents district taluka village surveyor createdAt")
    .populate("cadCenter", "name code availabilityStatus contact address")
    .populate("assignedTo", "name auth cadProfile")
    .populate("assignedBy", "name")
    .lean();
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  return slaDue.decorateAssignment(doc);
}

/**
 * Update assignment status (and optional assignedCadUserId while ASSIGNED, dueDate, notes).
 */
async function update(assignmentId, updates, actor) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  await assertPaymentGateForUploadId(doc.surveyorSketchUpload, "assignment_update");

  let reassignedCad = false;
  if (updates.assignedCadUserId !== undefined) {
    if (updates.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED) {
      throw new BadRequestError("Cannot set assignedCadUserId when cancelling the assignment", {
        code: "CONFLICTING_REASSIGN_AND_CANCEL",
      });
    }
    if (doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED) {
      throw new BadRequestError(
        "assignedCadUserId can only be changed while the assignment is ASSIGNED (before the CAD accepts). After CAD rejects, create a new assignment with POST.",
        { code: "REASSIGN_USER_ONLY_WHEN_ASSIGNED", currentStatus: doc.status }
      );
    }
    const cadUser = await User.findOne({
      _id: updates.assignedCadUserId,
      ...mongoRoleEquals(USER_ROLES.CAD),
      ...mongoStatusEquals(USER_STATUS.ACTIVE),
      deletedAt: null,
    }).lean();
    if (!cadUser) {
      throw new BadRequestError("assignedCadUserId must be an active CAD user", {
        code: "INVALID_ASSIGNED_CAD_USER",
      });
    }
    doc.assignedTo = cadUser._id;
    doc.cadCenter = null;
    doc.assignedAt = new Date();
    reassignedCad = true;
  }

  const allowed = {};
  if (updates.status && Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS).includes(updates.status)) {
    assertAssignmentStatusTransition(doc.status, updates.status);
    allowed.status = updates.status;
    if (updates.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
      allowed.completedAt = new Date();
    }
  }
  // M-10: client cannot set dueDate/dueAt — use sla-extend API
  if (updates.notes !== undefined) allowed.notes = updates.notes ? String(updates.notes).trim().slice(0, 1000) : null;

  Object.assign(doc, allowed);

  if (allowed.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD) {
    slaDue.pauseSla(doc);
  } else if (
    allowed.status &&
    doc.slaPausedAt &&
    allowed.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD &&
    allowed.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED
  ) {
    slaDue.resumeSla(doc);
  } else if (allowed.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
    const snap = slaDue.resolveSlaState(doc);
    doc.slaState = snap.state;
  } else if (allowed.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED) {
    doc.slaState = slaDue.SLA_STATE.CANCELLED;
  }

  await doc.save();

  if (reassignedCad && doc.surveyorSketchUpload) {
    await syncUploadStatusWithActiveAssignment(doc.surveyorSketchUpload);
  }

  // When assignment is cancelled, revert survey sketch status to PENDING so admin can reassign
  if (allowed.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED && doc.surveyorSketchUpload) {
    const upload = await loadUploadOrThrow(doc.surveyorSketchUpload, "status");
    assertSketchStatusTransition(upload.status, SURVEY_SKETCH_STATUS.PENDING);
    upload.status = SURVEY_SKETCH_STATUS.PENDING;
    await upload.save();
  }
  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();

  const hasOtherUpdates = Object.keys(allowed).length > 0;
  if (reassignedCad) {
    await notifyAssignmentEvent({
      type: "SURVEY_SKETCH_ASSIGNED",
      title: "Survey sketch reassigned",
      message: "A pending assignment was assigned to a different CAD user.",
      assignmentDoc: populated || doc,
      createdBy: actor?._id,
    });
  } else if (hasOtherUpdates) {
    await notifyAssignmentEvent({
      type: "SURVEY_SKETCH_ASSIGNMENT_UPDATED",
      title: "Assignment updated",
      message: `Assignment status updated to ${doc.status}.`,
      assignmentDoc: populated || doc,
      createdBy: actor?._id,
    });
  }
  return slaDue.decorateAssignment(populated);
}

/**
 * Admin pullback: move an active assignment from current CAD to another CAD user.
 * Sets assignment back to ASSIGNED and restarts accept window from assignedAt.
 */
async function pullbackAndReassign(assignmentId, { assignedCadUserId, reason }, actor) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  await assertPaymentGateForUploadId(doc.surveyorSketchUpload, "pullback_reassign");

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(doc.status)) {
    throw new BadRequestError(
      "Pullback is allowed only for ASSIGNED, IN_PROGRESS, or ON_HOLD assignments",
      { code: "INVALID_STATUS_FOR_PULLBACK", currentStatus: doc.status }
    );
  }

  const nextCadUser = await User.findOne({
    _id: assignedCadUserId,
    ...mongoRoleEquals(USER_ROLES.CAD),
    ...mongoStatusEquals(USER_STATUS.ACTIVE),
    deletedAt: null,
  }).lean();
  if (!nextCadUser) {
    throw new BadRequestError("assignedCadUserId must be an active CAD user", {
      code: "INVALID_ASSIGNED_CAD_USER",
    });
  }

  if (doc.assignedTo && String(doc.assignedTo) === String(nextCadUser._id)) {
    throw new BadRequestError("Assignment is already assigned to this CAD user", {
      code: "ALREADY_ASSIGNED_TO_SAME_CAD",
    });
  }

  doc.assignedTo = nextCadUser._id;
  doc.cadCenter = null;
  applyAssignmentStatus(doc, SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED);
  doc.completedAt = null;
  doc.rejectedByCad = null;
  slaDue.applySlaOnAssign(doc); // restart SLA clock on pullback
  await doc.save();
  if (doc.surveyorSketchUpload) {
    await syncUploadStatusWithActiveAssignment(doc.surveyorSketchUpload);
  }

  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();

  await notifyAssignmentEvent({
    type: "SURVEY_SKETCH_ASSIGNED",
    title: "Survey sketch pulled back and reassigned",
    message: reason
      ? `Admin pulled back and reassigned this assignment. Reason: ${String(reason).trim()}`
      : "Admin pulled back and reassigned this assignment.",
    assignmentDoc: populated || doc,
    createdBy: actor?._id,
  });

  return slaDue.decorateAssignment(populated);
}

const CAD_ASSIGNMENT_RESPONSE_ACTION = Object.freeze({ ACCEPT: "accept", REJECT: "reject" });

/**
 * Accept or reject an assignment (CAD user only).
 * Accept: status ASSIGNED -> IN_PROGRESS, assignedTo = cadUser (if not already set).
 * Reject: status ASSIGNED/IN_PROGRESS -> CANCELLED, survey sketch status -> PENDING (so admin can reassign).
 * Eligible if: assignment is pre-assigned to this CAD user, or (legacy) pool at their cadCenter.
 */
async function respondToAssignment(assignmentId, cadUser, action) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  await assertPaymentGateForUploadId(doc.surveyorSketchUpload, "cad_respond");

  const userCenterId =
    cadUser.cadProfile?.cadCenter != null ? String(cadUser.cadProfile.cadCenter) : null;
  const assignmentCenterId = doc.cadCenter != null ? String(doc.cadCenter) : null;
  const preAssignedId = doc.assignedTo != null ? String(doc.assignedTo) : null;
  const cadUserIdStr = String(cadUser._id);

  let canRespond = false;
  if (preAssignedId) {
    canRespond = preAssignedId === cadUserIdStr;
  } else if (assignmentCenterId && userCenterId) {
    canRespond = assignmentCenterId === userCenterId;
  }

  if (!canRespond) {
    if (preAssignedId) {
      throw new ForbiddenError("This assignment is assigned to another CAD user", {
        code: "ASSIGNMENT_NOT_FOR_YOU",
      });
    }
    throw new ForbiddenError(
      "CAD user must be linked to the assignment CAD center to accept pool work",
      { code: "CAD_CENTER_NOT_LINKED_OR_MISMATCH" }
    );
  }

  const isRejectRequest = action === CAD_ASSIGNMENT_RESPONSE_ACTION.REJECT;
  if (isRejectRequest) {
    const rejectableStatuses = [
      SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
      SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    ];
    if (!rejectableStatuses.includes(doc.status)) {
      throw new BadRequestError(
        `Reject is allowed only for ASSIGNED or IN_PROGRESS assignments. Current status: ${doc.status}`,
        { code: "INVALID_STATUS_FOR_REJECT", currentStatus: doc.status }
      );
    }
  } else if (doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED) {
    throw new BadRequestError(
      `Accept is allowed only when assignment status is ASSIGNED. Current status: ${doc.status}`,
      { code: "INVALID_STATUS_FOR_ACCEPT", currentStatus: doc.status }
    );
  }

  // Expiration safeguard: if CAD didn't accept within 2 hours, treat as auto-reject.
  let effectiveAction = action;
  if (doc.assignedAt && doc.assignedAt instanceof Date) {
    const ageMs = Date.now() - doc.assignedAt.getTime();
    if (ageMs > AUTO_REJECT_AFTER_MS) {
      effectiveAction = CAD_ASSIGNMENT_RESPONSE_ACTION.REJECT;
    }
  }

  const isAccept = effectiveAction === CAD_ASSIGNMENT_RESPONSE_ACTION.ACCEPT;

  if (isAccept) {
    applyAssignmentStatus(doc, SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS);
    if (!doc.assignedTo) {
      doc.assignedTo = cadUser._id;
    }
    await doc.save();
  } else {
    applyAssignmentStatus(doc, SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED);
    doc.rejectedByCad = cadUser._id;
    await doc.save();
    if (doc.surveyorSketchUpload) {
      const upload = await loadUploadOrThrow(doc.surveyorSketchUpload, "status");
      assertSketchStatusTransition(upload.status, SURVEY_SKETCH_STATUS.PENDING);
      upload.status = SURVEY_SKETCH_STATUS.PENDING;
      await upload.save();
    }
  }
  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
  await notifyAssignmentEvent({
    type: isAccept ? "SURVEY_SKETCH_ACCEPTED_BY_CAD" : "SURVEY_SKETCH_REJECTED_BY_CAD",
    title: isAccept ? "Assignment accepted by CAD" : "Assignment rejected by CAD",
    message: isAccept
      ? "CAD user accepted the assigned survey sketch."
      : "CAD user rejected the assigned survey sketch.",
    assignmentDoc: populated || doc,
    createdBy: cadUser?._id,
    extraTargetUsers: [cadUser?._id].filter(Boolean),
  });
  return populated;
}

/**
 * List all assignments (admin). Returns all assignments from DB; no status filter.
 * Optional filters: cadCenterId, surveyorSketchUploadId (for narrowing by center or sketch).
 */
async function listAll(filters = {}, pagination = null) {
  const query = {};
  if (filters.cadCenterId) query.cadCenter = filters.cadCenterId;
  if (filters.surveyorSketchUploadId) query.surveyorSketchUpload = filters.surveyorSketchUploadId;
  // Do not filter by status – return all assignments as stored in DB

  const limit = Math.min(100, Math.max(1, parseInt(pagination?.limit, 10) || 20));
  const skip = Math.max(0, ((parseInt(pagination?.page, 10) || 1) - 1) * limit);

  const [data, total] = await Promise.all([
    SurveySketchAssignment.find(query)
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyorSketchUpload", "applicationId surveyNo status createdAt")
      .populate("cadCenter", "name code availabilityStatus")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean(),
    SurveySketchAssignment.countDocuments(query),
  ]);
  return {
    data: slaDue.sortBySlaRisk(slaDue.decorateAssignmentList(data)),
    total,
    slaPolicy: slaDue.getPolicy(),
  };
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

/**
 * Auto-assign newly created survey sketch to best CAD center (M-09).
 * Delegates to autoAssign.service (persisted attempts, lock, retry, exception queue).
 */
async function autoAssignFromFlow(surveyorSketchUploadId, assignedByUserId) {
  const autoAssign = require("../autoAssign.service");
  return autoAssign.tryAutoAssign(surveyorSketchUploadId, {
    source: "SUBMIT",
    actorUserId: assignedByUserId,
  });
}

/**
 * Assignments visible to this CAD user: explicitly assigned to them, or unclaimed pool at their center (legacy).
 */
async function listForCadUser(cadUser, options = {}) {
  const now = new Date();
  const cutoff = new Date(now.getTime() - AUTO_REJECT_AFTER_MS);

  const userCenterId =
    cadUser.cadProfile?.cadCenter != null ? cadUser.cadProfile.cadCenter : null;
  const orClauses = [{ assignedTo: cadUser._id }];
  if (userCenterId) {
    orClauses.push({ assignedTo: null, cadCenter: userCenterId });
  }

  const filter = {
    $or: orClauses,
  };
  if (options.status != null && options.status !== "") {
    filter.status = options.status;
  } else {
    filter.status = { $ne: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED };
  }

  // UX safeguard: hide expired ASSIGNED work (assignedAt older than 2h).
  // Cron job will enforce the same rule by setting these assignments to CANCELLED.
  const shouldHideExpiredAssigned =
    options.status == null || options.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED;
  if (shouldHideExpiredAssigned) {
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { status: { $ne: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED } },
        { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED, assignedAt: { $gt: cutoff } },
      ],
    });
  }

  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const skip = Math.max(0, (parseInt(options.page, 10) || 1) - 1) * limit;

  const [data, total] = await Promise.all([
    SurveySketchAssignment.find(filter)
      .sort(
        String(options.sortBy || "").toLowerCase() === "assignedat"
          ? { assignedAt: -1 }
          : { dueAt: 1, assignedAt: -1 }
      )
      .skip(skip)
      .limit(limit)
      .populate("surveyorSketchUpload", "applicationId surveyNo status district taluka village createdAt cadDeliverable")
      .populate("cadCenter", "name code")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean(),
    SurveySketchAssignment.countDocuments(filter),
  ]);

  const decorated = slaDue.decorateAssignmentList(data);
  return {
    data: String(options.sortBy || "").toLowerCase() === "assignedat" ? decorated : slaDue.sortBySlaRisk(decorated),
    total,
    slaPolicy: slaDue.getPolicy(),
  };
}

/**
 * Auto-reject CAD assignments that stayed ASSIGNED for more than 2 hours.
 * - SurveySketchAssignment: ASSIGNED -> CANCELLED
 * - SurveyorSketchUpload: status -> PENDING (admin can reassign)
 */
async function autoRejectExpiredAssignments({ now = new Date(), limit = 250 } = {}) {
  const cutoff = new Date(now.getTime() - AUTO_REJECT_AFTER_MS);

  const expired = await SurveySketchAssignment.find({
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedAt: { $lte: cutoff },
  })
    .select("_id surveyorSketchUpload assignedTo assignedAt")
    .limit(Math.max(1, limit))
    .lean();

  if (!expired.length) {
    return { rejectedCount: 0 };
  }

  const ids = expired.map((e) => e._id);
  const uploadIds = expired.map((e) => e.surveyorSketchUpload).filter(Boolean);

  assertAssignmentStatusTransition(
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED
  );
  assertSketchStatusTransition(SURVEY_SKETCH_STATUS.ASSIGNED, SURVEY_SKETCH_STATUS.PENDING);

  await Promise.all([
    SurveySketchAssignment.updateMany(
      { _id: { $in: ids }, status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED },
      { $set: { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED } }
    ),
    uploadIds.length
      ? SurveyorSketchUpload.updateMany(
          {
            _id: { $in: uploadIds },
            status: SURVEY_SKETCH_STATUS.ASSIGNED,
          },
          { $set: { status: SURVEY_SKETCH_STATUS.PENDING } }
        )
      : Promise.resolve(),
  ]);

  return { rejectedCount: expired.length };
}

/**
 * CAD uploads finished sketch URL (after presign PUT). Sets upload.cadDeliverable, assignment COMPLETED, sketch CAD_DELIVERED.
 */
function buildCadDeliverableHistoryEntry({ revisionNo, isRevision, deliverables, submittedBy, submittedAt }) {
  const files = normalizeStoredDocumentList(deliverables);
  return {
    revisionNo,
    isRevision,
    deliverables: files,
    deliverable: files[0] || null,
    submittedBy,
    submittedAt,
  };
}

function hasCadDeliverableFiles(value) {
  return normalizeStoredDocumentList(value).length > 0;
}

async function deliverCadSketch(assignmentId, cadUser, fileMeta) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  await assertPaymentGateForUploadId(doc.surveyorSketchUpload, "cad_deliver");
  if (String(doc.assignedTo) !== String(cadUser._id)) {
    throw new ForbiddenError("Only the assigned CAD user can submit the deliverable", {
      code: "NOT_ASSIGNED_CAD_USER",
    });
  }
  if (
    doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS &&
    doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED
  ) {
    throw new BadRequestError(
      `Deliverable can only be submitted while assignment is ASSIGNED or IN_PROGRESS. Current: ${doc.status}`,
      { code: "INVALID_STATUS_FOR_DELIVER", currentStatus: doc.status }
    );
  }

  const uploadId = doc.surveyorSketchUpload;
  const cadDeliverableContract = require("../cadDeliverableContract.service");
  const bundle = cadDeliverableContract.assertCadDeliverableBundle(fileMeta.files);
  const cadDeliverables = bundle.files.map((file) => ({
    url: file.url,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    role: file.role,
    s3Key: file.s3Key,
    sha256: file.sha256,
    confirmed: file.confirmed,
    contractVersion: file.contractVersion,
    uploadedAt: file.uploadedAt || new Date(),
  }));
  if (!cadDeliverables.length) {
    throw new BadRequestError("At least one deliverable file is required", { code: "CAD_DELIVERABLE_REQUIRED" });
  }

  const uploadDoc = await SurveyorSketchUpload.findById(uploadId);
  if (!uploadDoc) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (!Array.isArray(uploadDoc.cadDeliverableHistory)) {
    uploadDoc.cadDeliverableHistory = [];
  }
  // Preserve previously submitted CAD files; never drop older entries.
  if (hasCadDeliverableFiles(uploadDoc.cadDeliverable) && uploadDoc.cadDeliverableHistory.length === 0) {
    const legacyFiles = normalizeStoredDocumentList(uploadDoc.cadDeliverable);
    uploadDoc.cadDeliverableHistory.push(
      buildCadDeliverableHistoryEntry({
        revisionNo: 0,
        isRevision: false,
        deliverables: legacyFiles,
        submittedBy: doc.assignedTo || cadUser._id,
        submittedAt: legacyFiles[0]?.uploadedAt || new Date(),
      })
    );
  }
  const nextBaseSubmissionNo = uploadDoc.cadDeliverableHistory.filter((h) => !h?.isRevision).length;
  uploadDoc.cadDeliverableHistory.push(
    buildCadDeliverableHistoryEntry({
      revisionNo: nextBaseSubmissionNo,
      isRevision: false,
      deliverables: cadDeliverables,
      submittedBy: cadUser._id,
      submittedAt: new Date(),
    })
  );
  uploadDoc.cadDeliverable = cadDeliverables;
  assertQcRequiredForRelease(ORDER_TYPES.STANDARD_11E);
  applySketchStatus(uploadDoc, SURVEY_SKETCH_STATUS.CAD_DELIVERED);
  const cadDownloadEntitlement = require("../cadDownloadEntitlement.service");
  await cadDownloadEntitlement.applyBalanceRequirementOnDelivery(uploadDoc);
  await uploadDoc.save();

  applyAssignmentStatus(doc, SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED);
  doc.completedAt = new Date();
  const snapComplete = slaDue.resolveSlaState(doc);
  doc.slaState = snapComplete.state;
  await doc.save();

  try {
    await cadWalletService.recordPendingEarningIfConfigured({
      cadUserId: cadUser._id,
      assignmentId: doc._id,
      surveyorSketchUploadId: uploadId,
      kind: CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY,
      revisionNo: 0,
    });
  } catch (wErr) {
    logger.error("cadWallet initial delivery record failed", wErr, { assignmentId: String(doc._id) });
  }

  const sketch = await SurveyorSketchUpload.findById(uploadId).select("surveyor applicationId surveyNo").lean();
  try {
    await notificationService.create({
      type: "CAD_SKETCH_DELIVERED",
      title: "CAD sketch ready",
      message: `Your sketch ${sketch?.applicationId || ""} is ready. Pay the balance (if required) then download from the app.`,
      entityType: "SurveyorSketchUpload",
      entityId: uploadId,
      targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN],
      targetUsers: sketch?.surveyor ? [sketch.surveyor] : [],
      createdBy: cadUser._id,
      data: { assignmentId: doc._id, applicationId: sketch?.applicationId || null },
    });
  } catch (err) {
    logger.error("Failed to notify surveyor of CAD deliverable", err, {
      assignmentId: String(assignmentId),
    });
  }

  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status cadDeliverable")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();

  await notifyAssignmentEvent({
    type: "SURVEY_SKETCH_DELIVERED_BY_CAD",
    title: "Assignment completed",
    message: "CAD submitted the finished sketch.",
    assignmentDoc: populated || doc,
    createdBy: cadUser?._id,
  });

  return slaDue.decorateAssignment(populated);
}

async function commitRevisionToUploadAndAssign(uploadDoc, surveyor, payload, nextRevisionNo, latestCompleted) {
  const revisionRequest = {
    revisionNo: nextRevisionNo,
    remarks: payload.remarks || null,
    audio: payload.audio || null,
    status: "REQUESTED",
    requestedBy: surveyor._id,
    requestedAt: new Date(),
    resolvedAt: null,
  };
  if (!Array.isArray(uploadDoc.revisionRequests)) {
    uploadDoc.revisionRequests = [];
  }
  uploadDoc.revisionRequests.push(revisionRequest);
  applySketchStatus(uploadDoc, SURVEY_SKETCH_STATUS.UNDER_REVISION);
  await uploadDoc.save();

  const reassignment = new SurveySketchAssignment({
    surveyorSketchUpload: uploadDoc._id,
    cadCenter: null,
    assignedTo: latestCompleted.assignedTo,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedBy: latestCompleted.assignedBy || surveyor._id,
    notes: `Auto-assigned for revision request #${nextRevisionNo}`,
  });
  slaDue.applySlaOnAssign(reassignment);
  await reassignment.save();
  await syncUploadStatusWithActiveAssignment(uploadDoc._id);

  return SurveyorSketchUpload.findById(uploadDoc._id)
    .populate("surveyor", "name role")
    .populate("district", "code name")
    .populate("taluka", "code name")
    .populate("hobli", "code name")
    .populate("village", "code name")
    .lean();
}

async function markRevisionPaymentFailed(merchantOrderId, phonepeResponse) {
  const m = String(merchantOrderId).match(/^rev_([a-f0-9]{24})_(\d+)$/i);
  if (!m) return;
  const uploadId = m[1];
  await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
    $set: {
      "pendingRevisionPayment.status": "FAILED",
      ...(phonepeResponse != null ? { "pendingRevisionPayment.phonepeResponse": phonepeResponse } : {}),
    },
  });
}

/**
 * PhonePe callback: apply pending revision #2+ after payment success.
 * Rejects when paid amount ≠ immutable expected pending.amountPaise (C-01).
 * Idempotent if revision already committed.
 */
async function completeRevisionAfterPayment(merchantOrderId, phonepeResponse = {}) {
  const m = String(merchantOrderId).match(/^rev_([a-f0-9]{24})_(\d+)$/i);
  if (!m) return null;
  const uploadId = m[1];
  const revisionNo = parseInt(m[2], 10);

  const uploadDoc = await SurveyorSketchUpload.findById(uploadId);
  if (!uploadDoc) return null;

  const already = uploadDoc.revisionRequests?.some((r) => r.revisionNo === revisionNo);
  if (already) {
    const lean = await SurveyorSketchUpload.findById(uploadId)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean();
    return { ...lean, paymentRejected: false };
  }

  const pending = uploadDoc.pendingRevisionPayment;
  if (!pending || pending.status !== "PENDING" || pending.revisionNo !== revisionNo) {
    return null;
  }

  if (pending.merchantOrderId && String(pending.merchantOrderId) !== String(merchantOrderId)) {
    logger.error("PhonePe revision merchantOrderId mismatch", {
      uploadId,
      stored: pending.merchantOrderId,
      callback: merchantOrderId,
    });
    await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
      $set: {
        "pendingRevisionPayment.status": "AMOUNT_MISMATCH",
        "pendingRevisionPayment.paymentFailureReason": "MERCHANT_ORDER_ID_MISMATCH",
        "pendingRevisionPayment.phonepeResponse": phonepeResponse,
      },
    });
    return { paymentRejected: true, reason: "MERCHANT_ORDER_ID_MISMATCH" };
  }

  const match = phonePeSketchPayment.assertPaidMatchesExpected(pending.amountPaise, phonepeResponse);
  if (!match.ok) {
    logger.error("PhonePe revision payment amount rejected", {
      uploadId,
      reason: match.reason,
      expectedPaise: match.expectedPaise,
      paidPaise: match.paidPaise,
    });
    await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
      $set: {
        "pendingRevisionPayment.status": "AMOUNT_MISMATCH",
        "pendingRevisionPayment.paymentFailureReason": match.reason,
        "pendingRevisionPayment.phonepeResponse": phonepeResponse,
      },
    });
    return { paymentRejected: true, reason: match.reason };
  }

  const latestCompleted = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    assignedTo: { $ne: null },
  })
    .sort({ completedAt: -1, assignedAt: -1, createdAt: -1 })
    .select("_id assignedTo assignedBy")
    .lean();
  if (!latestCompleted?.assignedTo) return null;

  const surveyor = await User.findById(uploadDoc.surveyor);
  if (!surveyor) return null;

  const payload = { remarks: pending.remarks, audio: pending.audio || null };

  const chargedPaise = pending.amountPaise != null ? Math.round(Number(pending.amountPaise)) : null;

  const feePaymentEntry = {
    revisionNo,
    merchantOrderId: pending.merchantOrderId || merchantOrderId,
    chargedAmountPaise: chargedPaise,
    paidAmountPaise: match.paidPaise,
    planAmountRupees: pending.planAmountRupees != null ? Number(pending.planAmountRupees) : null,
    discountRupees: pending.discountRupees != null ? Number(pending.discountRupees) : null,
    paidAt: new Date(),
    phonepeResponse: phonepeResponse && typeof phonepeResponse === "object" ? phonepeResponse : null,
  };

  await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $unset: { pendingRevisionPayment: 1 } });
  const fresh = await SurveyorSketchUpload.findById(uploadId);
  if (!fresh) return null;

  const result = await commitRevisionToUploadAndAssign(fresh, surveyor, payload, revisionNo, latestCompleted);

  await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $push: { revisionFeePayments: feePaymentEntry } });

  return result ? { ...result, paymentRejected: false } : { paymentRejected: false };
}

async function requestSketchRevision(uploadId, surveyor, payload) {
  let uploadDoc = await SurveyorSketchUpload.findById(uploadId);
  if (!uploadDoc) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  assertSketchBookingPaymentAllowsWorkflow(uploadDoc, { action: "revision_request" });
  if (String(uploadDoc.surveyor) !== String(surveyor._id)) {
    throw new ForbiddenError("You can request revision only for your own sketch", {
      code: "NOT_YOUR_SKETCH",
    });
  }
  if (!hasCadDeliverableFiles(uploadDoc.cadDeliverable)) {
    throw new BadRequestError("CAD has not delivered a sketch yet", {
      code: "NO_CAD_DELIVERABLE",
    });
  }

  const pendingPay = uploadDoc.pendingRevisionPayment;
  if (pendingPay?.status === "PENDING") {
    const staleMs = Math.max(
      60_000,
      parseInt(process.env.REVISION_PAYMENT_PENDING_STALE_MS || String(24 * 60 * 60 * 1000), 10) || 24 * 60 * 60 * 1000
    );
    const requestedAtMs = pendingPay.requestedAt ? new Date(pendingPay.requestedAt).getTime() : 0;
    const isStale = requestedAtMs > 0 && Date.now() - requestedAtMs > staleMs;

    if (isStale) {
      await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $unset: { pendingRevisionPayment: 1 } });
      uploadDoc = await SurveyorSketchUpload.findById(uploadId);
    } else {
      // Payment still pending: never return 409 — always issue (or re-issue) checkout so the client can pay.
      if (payload.remarks !== undefined) {
        uploadDoc.pendingRevisionPayment.remarks = payload.remarks;
      }
      if (payload.audio !== undefined) {
        uploadDoc.pendingRevisionPayment.audio = payload.audio;
      }
      if (payload.remarks !== undefined || payload.audio !== undefined) {
        await uploadDoc.save();
      }

      const phonePe = phonePeSketchPayment;
      if (!phonePe.isPhonePeConfigured()) {
        throw new BadRequestError("Revision fee is configured but PhonePe is not configured.", {
          code: "PHONEPE_NOT_CONFIGURED",
        });
      }
      // Keep immutable expected amount from first initiation; do not accept client overrides.
      const merchantOrderId = uploadDoc.pendingRevisionPayment.merchantOrderId || pendingPay.merchantOrderId;
      const revisionFeePaise = Number(uploadDoc.pendingRevisionPayment.amountPaise);
      if (!merchantOrderId || !Number.isFinite(revisionFeePaise) || revisionFeePaise <= 0) {
        await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $unset: { pendingRevisionPayment: 1 } });
        throw new BadRequestError("Pending revision payment data is invalid; please submit the revision request again.", {
          code: "REVISION_PAYMENT_CORRUPT",
        });
      }
      let checkoutPageUrl;
      try {
        logger.info("PhonePe initiatePay pending revision resume", {
          uploadId: String(uploadId),
          merchantOrderId,
          amountPaise: revisionFeePaise,
          payableRupees: revisionFeePaise / 100,
        });
        const pr = await phonePe.initiatePay(merchantOrderId, revisionFeePaise);
        checkoutPageUrl = pr.redirectUrl;
        try {
          await paymentAttempt.recordInitiated({
            purpose: paymentAttempt.PAYMENT_PURPOSE.REVISION,
            surveyorSketchUploadId: uploadId,
            surveyorId: surveyor._id,
            merchantOrderId,
            expectedAmountPaise: revisionFeePaise,
            revisionNo: uploadDoc.pendingRevisionPayment.revisionNo,
          });
        } catch (ledgerErr) {
          logger.error("Failed to record revision payment attempt (resume)", ledgerErr, {
            uploadId: String(uploadId),
            merchantOrderId,
          });
        }
      } catch (pe) {
        logger.error("PhonePe initiatePay failed for pending revision (resume checkout)", pe, { uploadId: String(uploadId) });
        if (pe instanceof BadRequestError) throw pe;
        throw new BadRequestError(pe?.message || "Payment gateway error", { code: "PHONEPE_INIT_FAILED" });
      }
      const lean = await SurveyorSketchUpload.findById(uploadId)
        .populate("surveyor", "name role")
        .populate("district", "code name")
        .populate("taluka", "code name")
        .populate("hobli", "code name")
        .populate("village", "code name")
        .lean();
      return {
        data: lean,
        meta: {
          payment: {
            requiresPayment: true,
            checkoutPageUrl,
            redirectUrl: checkoutPageUrl,
            merchantOrderId,
            amountPaise: revisionFeePaise,
            revisionNo: pendingPay.revisionNo,
            planAmountRupees: pendingPay.planAmountRupees ?? null,
            discountRupees: pendingPay.discountRupees ?? null,
            payableRupees:
              revisionFeePaise != null && Number.isFinite(revisionFeePaise) ? revisionFeePaise / 100 : null,
            message: payload.retryPayment
              ? "Retrying checkout for your pending revision payment."
              : "Complete payment to submit this revision. Checkout link refreshed.",
          },
        },
      };
    }
  }

  const existingRevisionAssignment = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: {
      $in: [
        SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
        SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
        SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
      ],
    },
  }).select("_id status").lean();
  if (existingRevisionAssignment) {
    throw new ConflictError(
      "A revision assignment is already active for this sketch.",
      { code: "REVISION_ASSIGNMENT_ALREADY_ACTIVE", assignmentId: existingRevisionAssignment._id }
    );
  }

  const latestCompleted = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: uploadId,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    assignedTo: { $ne: null },
  })
    .sort({ completedAt: -1, assignedAt: -1, createdAt: -1 })
    .select("_id assignedTo assignedBy")
    .lean();
  if (!latestCompleted?.assignedTo) {
    throw new BadRequestError(
      "No previously completed CAD assignment found to auto-reassign for revision.",
      { code: "NO_COMPLETED_ASSIGNMENT_FOR_REVISION" }
    );
  }

  const nextRevisionNo = (uploadDoc.revisionRequests?.length || 0) + 1;
  const phonePe = phonePeSketchPayment;
  const resolvedRevision = await sketchPaymentPricing.resolveSketchRevisionFee();
  const revisionFeePaise = resolvedRevision.feePaise;
  const mustPay = nextRevisionNo >= 2 && revisionFeePaise > 0;

  if (mustPay) {
    if (!phonePe.isPhonePeConfigured()) {
      throw new BadRequestError("Revision fee is configured but PhonePe is not configured.", {
        code: "PHONEPE_NOT_CONFIGURED",
      });
    }
    const merchantOrderId = `rev_${uploadId}_${nextRevisionNo}`;
    uploadDoc.pendingRevisionPayment = {
      revisionNo: nextRevisionNo,
      remarks: payload.remarks || null,
      audio: payload.audio || null,
      status: "PENDING",
      merchantOrderId,
      amountPaise: revisionFeePaise,
      planAmountRupees: resolvedRevision.planAmountRupees,
      discountRupees: resolvedRevision.discountRupees,
      pricingSource: resolvedRevision.source,
      requestedAt: new Date(),
    };
    await uploadDoc.save();
    let checkoutPageUrl;
    try {
      logger.info("PhonePe initiatePay sketch revision", {
        uploadId: String(uploadId),
        merchantOrderId,
        amountPaise: revisionFeePaise,
        payableRupees: revisionFeePaise / 100,
        pricingSource: resolvedRevision.source,
        revisionNo: nextRevisionNo,
      });
      const pr = await phonePe.initiatePay(merchantOrderId, revisionFeePaise);
      checkoutPageUrl = pr.redirectUrl;
      try {
        await paymentAttempt.recordInitiated({
          purpose: paymentAttempt.PAYMENT_PURPOSE.REVISION,
          surveyorSketchUploadId: uploadId,
          surveyorId: surveyor._id,
          merchantOrderId,
          expectedAmountPaise: revisionFeePaise,
          revisionNo: nextRevisionNo,
        });
      } catch (ledgerErr) {
        logger.error("Failed to record revision payment attempt", ledgerErr, {
          uploadId: String(uploadId),
          merchantOrderId,
        });
      }
    } catch (pe) {
      logger.error("PhonePe initiatePay failed for sketch revision", pe, { uploadId: String(uploadId) });
      await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $unset: { pendingRevisionPayment: 1 } });
      if (pe instanceof BadRequestError) throw pe;
      throw new BadRequestError(pe?.message || "Payment gateway error", { code: "PHONEPE_INIT_FAILED" });
    }
    const lean = await SurveyorSketchUpload.findById(uploadId)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean();
    return {
      data: lean,
      meta: {
        payment: {
          requiresPayment: true,
          checkoutPageUrl,
          redirectUrl: checkoutPageUrl,
          merchantOrderId,
          amountPaise: revisionFeePaise,
          revisionNo: nextRevisionNo,
          planAmountRupees: resolvedRevision.planAmountRupees,
          discountRupees: resolvedRevision.discountRupees,
          payableRupees: resolvedRevision.payableRupees,
          pricingSource: resolvedRevision.source,
        },
      },
    };
  }

  const data = await commitRevisionToUploadAndAssign(uploadDoc, surveyor, payload, nextRevisionNo, latestCompleted);
  return {
    data,
    meta: {
      payment: {
        requiresPayment: false,
        revisionNo: nextRevisionNo,
        message:
          nextRevisionNo >= 2
            ? "No checkout URL: set SKETCH_REVISION_FEE_PAISE > 0 and PUBLIC_API_BASE_URL to charge for revision #2+."
            : "First revision is free; no payment required.",
      },
    },
  };
}

async function deliverCadSketchRevision(assignmentId, cadUser, fileMeta) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  if (String(doc.assignedTo) !== String(cadUser._id)) {
    throw new ForbiddenError("Only the assigned CAD user can submit revision deliverable", {
      code: "NOT_ASSIGNED_CAD_USER",
    });
  }
  if (
    doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED &&
    doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS
  ) {
    throw new BadRequestError(
      `Revision deliverable can be submitted only for IN_PROGRESS or COMPLETED assignment. Current: ${doc.status}`,
      { code: "INVALID_STATUS_FOR_REVISION_DELIVER", currentStatus: doc.status }
    );
  }

  const uploadDoc = await SurveyorSketchUpload.findById(doc.surveyorSketchUpload);
  if (!uploadDoc) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  assertSketchBookingPaymentAllowsWorkflow(uploadDoc, { action: "cad_revision_deliver" });
  if (!hasCadDeliverableFiles(uploadDoc.cadDeliverable)) {
    throw new BadRequestError(
      "Base CAD deliverable not found. Submit initial deliverable first.",
      { code: "BASE_CAD_DELIVERABLE_MISSING" }
    );
  }

  const cadDeliverableContract = require("../cadDeliverableContract.service");
  const bundle = cadDeliverableContract.assertCadDeliverableBundle(fileMeta.files);
  const revisedDeliverables = bundle.files.map((file) => ({
    url: file.url,
    fileName: file.fileName,
    mimeType: file.mimeType,
    size: file.size,
    role: file.role,
    s3Key: file.s3Key,
    sha256: file.sha256,
    confirmed: file.confirmed,
    contractVersion: file.contractVersion,
    uploadedAt: file.uploadedAt || new Date(),
  }));
  if (!revisedDeliverables.length) {
    throw new BadRequestError("At least one deliverable file is required", { code: "CAD_DELIVERABLE_REQUIRED" });
  }

  if (!Array.isArray(uploadDoc.cadDeliverableHistory)) {
    uploadDoc.cadDeliverableHistory = [];
  }
  if (!uploadDoc.cadDeliverableHistory.length && hasCadDeliverableFiles(uploadDoc.cadDeliverable)) {
    const legacyFiles = normalizeStoredDocumentList(uploadDoc.cadDeliverable);
    uploadDoc.cadDeliverableHistory.push(
      buildCadDeliverableHistoryEntry({
        revisionNo: 0,
        isRevision: false,
        deliverables: legacyFiles,
        submittedBy: doc.assignedTo || null,
        submittedAt: legacyFiles[0]?.uploadedAt || new Date(),
      })
    );
  }

  const nextRevisionNo = uploadDoc.cadDeliverableHistory.filter((h) => h?.isRevision).length + 1;
  uploadDoc.cadDeliverableHistory.push(
    buildCadDeliverableHistoryEntry({
      revisionNo: nextRevisionNo,
      isRevision: true,
      deliverables: revisedDeliverables,
      submittedBy: cadUser._id,
      submittedAt: new Date(),
    })
  );
  uploadDoc.cadDeliverable = revisedDeliverables;
  assertQcRequiredForRelease(ORDER_TYPES.STANDARD_11E);
  applySketchStatus(uploadDoc, SURVEY_SKETCH_STATUS.CAD_DELIVERED);

  if (Array.isArray(uploadDoc.revisionRequests)) {
    const lastOpen = [...uploadDoc.revisionRequests].reverse().find((r) => r.status === "REQUESTED");
    if (lastOpen) {
      lastOpen.status = "RESOLVED";
      lastOpen.resolvedAt = new Date();
    }
  }

  const cadDownloadEntitlement = require("../cadDownloadEntitlement.service");
  await cadDownloadEntitlement.applyBalanceRequirementOnDelivery(uploadDoc);
  await uploadDoc.save();

  applyAssignmentStatus(doc, SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED);
  doc.completedAt = new Date();
  const snapComplete = slaDue.resolveSlaState(doc);
  doc.slaState = snapComplete.state;
  await doc.save();

  try {
    await cadWalletService.recordPendingEarningIfConfigured({
      cadUserId: cadUser._id,
      assignmentId: doc._id,
      surveyorSketchUploadId: doc.surveyorSketchUpload,
      kind: CAD_WALLET_ENTRY_KIND.REVISION_DELIVERY,
      revisionNo: nextRevisionNo,
    });
  } catch (wErr) {
    logger.error("cadWallet revision delivery record failed", wErr, { assignmentId: String(doc._id) });
  }

  return slaDue.decorateAssignment(
    await SurveySketchAssignment.findById(doc._id)
      .populate("surveyorSketchUpload", "applicationId surveyNo status cadDeliverable cadDeliverableHistory revisionRequests")
      .populate("cadCenter", "name code")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean()
  );
}
async function getCadDashboardStats(cadUser) {
  const uid = cadUser._id;
  const touched = { $or: [{ assignedTo: uid }, { rejectedByCad: uid }] };

  const [
    totalOrders,
    pendingAcceptOrders,
    inProgressOrders,
    completedOrders,
    rejectedOrders,
  ] = await Promise.all([
    SurveySketchAssignment.countDocuments(touched),
    SurveySketchAssignment.countDocuments({
      assignedTo: uid,
      status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    }),
    SurveySketchAssignment.countDocuments({
      assignedTo: uid,
      status: {
        $in: [
          SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
          SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
        ],
      },
    }),
    SurveySketchAssignment.countDocuments({
      assignedTo: uid,
      status: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    }),
    SurveySketchAssignment.countDocuments({
      rejectedByCad: uid,
      status: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
    }),
  ]);

  // Legacy: acceptedOrders = working + completed (does NOT include pending accept).
  const acceptedOrders = inProgressOrders + completedOrders;

  return {
    totalOrders,
    pendingAcceptOrders,
    inProgressOrders,
    completedOrders,
    /** @deprecated Prefer pendingAccept + inProgress + completed; kept for existing FE cards. */
    acceptedOrders,
    rejectedOrders,
    countSemantics: {
      version: "CAD_DASHBOARD_COUNTS_V2",
      note:
        "Do not expect acceptedOrders + rejectedOrders === totalOrders. " +
        "pendingAcceptOrders (ASSIGNED, not yet accepted) is in totalOrders but not in acceptedOrders. " +
        "Partition: pendingAccept + inProgress + completed + rejected ≈ rows this CAD touched (minus cancelled-by-admin without reject).",
      fields: {
        totalOrders: "assignedTo OR rejectedByCad (all statuses)",
        pendingAcceptOrders: "assignedTo + status ASSIGNED",
        inProgressOrders: "assignedTo + IN_PROGRESS|ON_HOLD",
        completedOrders: "assignedTo + COMPLETED",
        acceptedOrders: "legacy = inProgressOrders + completedOrders",
        rejectedOrders: "rejectedByCad + CANCELLED",
      },
    },
  };
}

/**
 * Admin: immutable SLA extension (hours or ms).
 */
async function extendAssignmentSla(assignmentId, { hours, ms, reason }, actor) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  if (
    ![
      SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
      SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
      SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
    ].includes(doc.status)
  ) {
    throw new BadRequestError("SLA can only be extended on open assignments", {
      code: "SLA_EXTEND_NOT_ALLOWED",
      currentStatus: doc.status,
    });
  }
  if (!doc.dueAt && !doc.slaDurationMs) {
    slaDue.applySlaOnAssign(doc);
  }
  let extendMs = ms != null ? Number(ms) : null;
  if (extendMs == null && hours != null) {
    extendMs = Math.round(Number(hours) * 3600 * 1000);
  }
  const entry = slaDue.extendSla(doc, {
    ms: extendMs,
    reason,
    by: actor?._id || null,
  });
  await doc.save();

  try {
    await notificationService.create({
      type: "SLA_EXTENDED",
      title: "Delivery deadline extended",
      message: reason || `SLA extended by ${Math.round(entry.ms / 3600000)}h`,
      entityType: "SurveySketchAssignment",
      entityId: doc._id,
      targetRoles: [USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CAD, USER_ROLES.SURVEYOR],
      createdBy: actor?._id,
      data: { dueAt: doc.dueAt, extensionMs: entry.ms },
    });
  } catch (err) {
    logger.error("SLA extend notification failed", err, { assignmentId: String(assignmentId) });
  }

  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
  return slaDue.decorateAssignment(populated);
}

/**
 * Recompute slaState + emit warning/escalate/breach alerts (scheduled).
 * Alert summary counts are live aging (OPS-01), not only newly transitioned rows.
 * Scans all open assignments (sorted by dueAt); optional limit only caps transition processing.
 */
async function processSlaAlerts({ limit = null } = {}) {
  const openStatuses = [
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
  ];
  const open = await SurveySketchAssignment.find({ status: { $in: openStatuses } })
    .select(
      "status assignedAt dueAt slaDurationMs slaPausedTotalMs slaPausedAt slaExtensions slaState assignedTo surveyorSketchUpload"
    )
    .sort({ dueAt: 1 })
    .lean();

  const updates = [];

  // Backfill dueAt on all open rows first so aging matches live truth.
  for (const a of open) {
    if (!a.dueAt && a.assignedAt) {
      const slaDurationMs = a.slaDurationMs || slaDue.getStandardSlaMs();
      const dueAt = slaDue.computeDueAt({
        assignedAt: a.assignedAt,
        slaDurationMs,
        pausedTotalMs: a.slaPausedTotalMs || 0,
        slaPausedAt: a.slaPausedAt,
        extensions: a.slaExtensions || [],
      });
      a.dueAt = dueAt;
      a.slaDurationMs = slaDurationMs;
      updates.push(
        SurveySketchAssignment.updateOne(
          { _id: a._id },
          { $set: { dueAt, dueDate: dueAt, slaDurationMs } }
        )
      );
    }
  }

  const aging = slaDue.computeSlaAgingSummary(open, { itemLimit: 50 });
  const processLimit =
    limit != null && Number(limit) > 0 ? Math.min(Number(limit), open.length) : open.length;
  const toProcess = open.slice(0, processLimit);

  let newlyWarned = 0;
  let newlyEscalated = 0;
  let newlyBreached = 0;

  for (const a of toProcess) {
    const snap = slaDue.resolveSlaState(a);
    if (snap.state !== a.slaState) {
      updates.push(
        SurveySketchAssignment.updateOne(
          { _id: a._id },
          { $set: { slaState: snap.state, dueAt: snap.dueAt } }
        )
      );
    }

    if (snap.state === slaDue.SLA_STATE.WARNING && a.slaState !== slaDue.SLA_STATE.WARNING) {
      newlyWarned += 1;
      logger.warn("ALERT_SLA_WARNING", {
        alertType: "SLA_WARNING",
        severity: "medium",
        assignmentId: String(a._id),
        dueAt: snap.dueAt,
        remainingMs: snap.remainingMs,
        escalateTo: "operations",
      });
    } else if (
      snap.state === slaDue.SLA_STATE.ESCALATED &&
      a.slaState !== slaDue.SLA_STATE.ESCALATED
    ) {
      newlyEscalated += 1;
      logger.warn("ALERT_SLA_ESCALATED", {
        alertType: "SLA_ESCALATED",
        severity: "high",
        assignmentId: String(a._id),
        dueAt: snap.dueAt,
        remainingMs: snap.remainingMs,
        escalateTo: "operations",
      });
    } else if (
      snap.state === slaDue.SLA_STATE.BREACHED &&
      a.slaState !== slaDue.SLA_STATE.BREACHED
    ) {
      newlyBreached += 1;
      logger.warn("ALERT_SLA_BREACH", {
        alertType: "SLA_BREACH",
        severity: "high",
        assignmentId: String(a._id),
        dueAt: snap.dueAt,
        remainingMs: snap.remainingMs,
        escalateTo: "operations",
      });
    }
  }

  if (updates.length) await Promise.all(updates);

  // Summary fields match live aging (same as getSlaAging / observability alerts).
  return {
    scanned: open.length,
    processed: toProcess.length,
    warned: aging.warning,
    escalated: aging.escalated,
    breached: aging.breached,
    paused: aging.paused,
    withinSla: aging.withinSla,
    openCount: aging.openCount,
    transitions: {
      warned: newlyWarned,
      escalated: newlyEscalated,
      breached: newlyBreached,
    },
    newlyWarned,
    newlyEscalated,
    newlyBreached,
    aging: {
      withinSla: aging.withinSla,
      warning: aging.warning,
      escalated: aging.escalated,
      breached: aging.breached,
      paused: aging.paused,
      openCount: aging.openCount,
      items: aging.items,
    },
  };
}

module.exports = {
  create,
  listByCadCenter,
  listForCadUser,
  getAssignmentCountsByCenter,
  getById,
  update,
  respondToAssignment,
  deliverCadSketch,
  requestSketchRevision,
  completeRevisionAfterPayment,
  markRevisionPaymentFailed,
  deliverCadSketchRevision,
  listAll,
  autoAssignFromFlow,
  autoRejectExpiredAssignments,
  getCadDashboardStats,
  pullbackAndReassign,
  syncUploadStatusWithActiveAssignment,
  repairUploadStatusesForSurveyor,
  extendAssignmentSla,
  processSlaAlerts,
};
