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
const sketchPaymentPricing = require("../sketchPaymentPricing.service");
const phonePeSketchPayment = require("../phonePeSketchPayment.service");
const cadWalletService = require("../cadWallet.service");
const { normalizeStoredDocumentList } = require("../../utils/surveyDocuments");

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

  const sketch = await SurveyorSketchUpload.findById(surveyorSketchUploadId).lean();
  if (!sketch) {
    throw new NotFoundError("Survey sketch upload not found", {
      code: "SURVEY_SKETCH_NOT_FOUND",
    });
  }
  if (sketch.status === SURVEY_SKETCH_STATUS.PAYMENT_PENDING) {
    throw new BadRequestError("Survey sketch payment is not completed yet.", {
      code: "SKETCH_PAYMENT_PENDING",
    });
  }

  let cadCenterToStore = null;
  let initialAssignedTo = null;

  if (assignedCadUserId) {
    const cadUser = await User.findOne({
      _id: assignedCadUserId,
      role: USER_ROLES.CAD,
      status: USER_STATUS.ACTIVE,
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
        role: USER_ROLES.CAD,
        status: USER_STATUS.ACTIVE,
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
        existing.assignedAt = new Date();
        existing.dueDate = dueDate ? new Date(dueDate) : existing.dueDate || null;
        existing.notes = notes ? String(notes).trim().slice(0, 1000) : existing.notes || null;
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

        return reassigned;
      }

      // If current active assignment already moved forward (IN_PROGRESS/ON_HOLD),
      // close it and create a fresh reassignment.
      existing.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED;
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
    dueDate: dueDate ? new Date(dueDate) : null,
    notes: notes ? String(notes).trim().slice(0, 1000) : null,
  });

  await doc.save();

  await SurveyorSketchUpload.findByIdAndUpdate(surveyorSketchUploadId, {
    status: SURVEY_SKETCH_STATUS.ASSIGNED,
  });

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

  return populated;
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

  return { data, total };
}

/**
 * Get assignment counts by CAD center (for list view).
 */
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
  return doc;
}

/**
 * Update assignment status (and optional assignedCadUserId while ASSIGNED, dueDate, notes).
 */
async function update(assignmentId, updates, actor) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }

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
      role: USER_ROLES.CAD,
      status: USER_STATUS.ACTIVE,
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
    allowed.status = updates.status;
    if (updates.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
      allowed.completedAt = new Date();
    }
  }
  if (updates.dueDate !== undefined) allowed.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
  if (updates.notes !== undefined) allowed.notes = updates.notes ? String(updates.notes).trim().slice(0, 1000) : null;

  Object.assign(doc, allowed);
  await doc.save();

  if (reassignedCad && doc.surveyorSketchUpload) {
    await syncUploadStatusWithActiveAssignment(doc.surveyorSketchUpload);
  }

  // When assignment is cancelled, revert survey sketch status to PENDING so admin can reassign
  if (allowed.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED && doc.surveyorSketchUpload) {
    await SurveyorSketchUpload.findByIdAndUpdate(doc.surveyorSketchUpload, {
      status: SURVEY_SKETCH_STATUS.PENDING,
    });
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
  return populated;
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

  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(doc.status)) {
    throw new BadRequestError(
      "Pullback is allowed only for ASSIGNED, IN_PROGRESS, or ON_HOLD assignments",
      { code: "INVALID_STATUS_FOR_PULLBACK", currentStatus: doc.status }
    );
  }

  const nextCadUser = await User.findOne({
    _id: assignedCadUserId,
    role: USER_ROLES.CAD,
    status: USER_STATUS.ACTIVE,
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
  doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED;
  doc.assignedAt = new Date();
  doc.completedAt = null;
  doc.rejectedByCad = null;
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

  return populated;
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
    doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS;
    if (!doc.assignedTo) {
      doc.assignedTo = cadUser._id;
    }
    await doc.save();
  } else {
    doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED;
    doc.rejectedByCad = cadUser._id;
    await doc.save();
    if (doc.surveyorSketchUpload) {
      await SurveyorSketchUpload.findByIdAndUpdate(doc.surveyorSketchUpload, {
        status: SURVEY_SKETCH_STATUS.PENDING,
      });
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
  return { data, total };
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
 * Auto-assign newly created survey sketch to best CAD center.
 * Used only when admin toggle is enabled.
 */
async function autoAssignFromFlow(surveyorSketchUploadId, assignedByUserId) {
  if (!assignedByUserId) return null;

  const [sketch, assignedBy] = await Promise.all([
    SurveyorSketchUpload.findById(surveyorSketchUploadId).select("_id status").lean(),
    User.findById(assignedByUserId).select("_id role").lean(),
  ]);
  if (!sketch || !assignedBy) return null;

  const existing = await SurveySketchAssignment.findOne({
    surveyorSketchUpload: surveyorSketchUploadId,
    status: { $in: ACTIVE_ASSIGNMENT_STATUSES },
  }).lean();
  if (existing) return existing;

  const cadCenterId = await pickCadCenterForAutoAssign();
  if (!cadCenterId) return null;

  const doc = new SurveySketchAssignment({
    surveyorSketchUpload: surveyorSketchUploadId,
    cadCenter: cadCenterId,
    assignedTo: null,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedBy: assignedBy._id,
  });
  await doc.save();

  await SurveyorSketchUpload.findByIdAndUpdate(surveyorSketchUploadId, {
    status: SURVEY_SKETCH_STATUS.ASSIGNED,
  });
  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code availabilityStatus")
    .populate("assignedBy", "name")
    .lean();
  await notifyAssignmentEvent({
    type: "SURVEY_SKETCH_AUTO_ASSIGNED",
    title: "Survey sketch auto-assigned",
    message: "A new survey sketch was automatically assigned to a CAD center.",
    assignmentDoc: populated || doc,
    createdBy: assignedBy?._id,
  });
  return populated;
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
      .sort({ assignedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyorSketchUpload", "applicationId surveyNo status district taluka village createdAt cadDeliverable")
      .populate("cadCenter", "name code")
      .populate("assignedTo", "name auth")
      .populate("assignedBy", "name")
      .lean(),
    SurveySketchAssignment.countDocuments(filter),
  ]);

  return { data, total };
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

  await Promise.all([
    SurveySketchAssignment.updateMany(
      { _id: { $in: ids }, status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED },
      { $set: { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED } }
    ),
    uploadIds.length
      ? SurveyorSketchUpload.updateMany(
          { _id: { $in: uploadIds } },
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
  const cadDeliverables = normalizeStoredDocumentList(fileMeta.files).map((file) => ({
    url: String(file.url).trim(),
    fileName: file.fileName != null ? String(file.fileName).trim() : null,
    mimeType: file.mimeType != null ? String(file.mimeType).trim() : null,
    size: file.size != null && file.size !== "" ? Number(file.size) : null,
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
  uploadDoc.status = SURVEY_SKETCH_STATUS.CAD_DELIVERED;
  await uploadDoc.save();

  doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED;
  doc.completedAt = new Date();
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
      message: `Your sketch ${sketch?.applicationId || ""} is ready to download.`,
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

  return populated;
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
  uploadDoc.status = SURVEY_SKETCH_STATUS.UNDER_REVISION;
  await uploadDoc.save();

  const reassignment = new SurveySketchAssignment({
    surveyorSketchUpload: uploadDoc._id,
    cadCenter: null,
    assignedTo: latestCompleted.assignedTo,
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedBy: latestCompleted.assignedBy || surveyor._id,
    notes: `Auto-assigned for revision request #${nextRevisionNo}`,
  });
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
    return SurveyorSketchUpload.findById(uploadId)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean();
  }

  const pending = uploadDoc.pendingRevisionPayment;
  if (!pending || pending.status !== "PENDING" || pending.revisionNo !== revisionNo) {
    return null;
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
  const paidAmountPaise =
    phonePeSketchPayment.extractPaidAmountPaise(phonepeResponse) ??
    (chargedPaise != null && Number.isFinite(chargedPaise) ? chargedPaise : null);

  const feePaymentEntry = {
    revisionNo,
    merchantOrderId: pending.merchantOrderId || merchantOrderId,
    chargedAmountPaise: chargedPaise,
    paidAmountPaise,
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

  return result;
}

async function requestSketchRevision(uploadId, surveyor, payload) {
  let uploadDoc = await SurveyorSketchUpload.findById(uploadId);
  if (!uploadDoc) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
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
      const merchantOrderId = pendingPay.merchantOrderId;
      const revisionFeePaise = Number(pendingPay.amountPaise);
      if (!merchantOrderId || !Number.isFinite(revisionFeePaise) || revisionFeePaise <= 0) {
        await SurveyorSketchUpload.findByIdAndUpdate(uploadId, { $unset: { pendingRevisionPayment: 1 } });
        throw new BadRequestError("Pending revision payment data is invalid; please submit the revision request again.", {
          code: "REVISION_PAYMENT_CORRUPT",
        });
      }
      let checkoutPageUrl;
      try {
        const pr = await phonePe.initiatePay(merchantOrderId, revisionFeePaise);
        checkoutPageUrl = pr.redirectUrl;
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
      requestedAt: new Date(),
    };
    await uploadDoc.save();
    let checkoutPageUrl;
    try {
      const pr = await phonePe.initiatePay(merchantOrderId, revisionFeePaise);
      checkoutPageUrl = pr.redirectUrl;
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
  if (!hasCadDeliverableFiles(uploadDoc.cadDeliverable)) {
    throw new BadRequestError(
      "Base CAD deliverable not found. Submit initial deliverable first.",
      { code: "BASE_CAD_DELIVERABLE_MISSING" }
    );
  }

  const revisedDeliverables = normalizeStoredDocumentList(fileMeta.files).map((file) => ({
    url: String(file.url).trim(),
    fileName: file.fileName != null ? String(file.fileName).trim() : null,
    mimeType: file.mimeType != null ? String(file.mimeType).trim() : null,
    size: file.size != null && file.size !== "" ? Number(file.size) : null,
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
  uploadDoc.status = SURVEY_SKETCH_STATUS.CAD_DELIVERED;

  if (Array.isArray(uploadDoc.revisionRequests)) {
    const lastOpen = [...uploadDoc.revisionRequests].reverse().find((r) => r.status === "REQUESTED");
    if (lastOpen) {
      lastOpen.status = "RESOLVED";
      lastOpen.resolvedAt = new Date();
    }
  }

  await uploadDoc.save();

  doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED;
  doc.completedAt = new Date();
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

  return SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status cadDeliverable cadDeliverableHistory revisionRequests")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
}

/**
 * CAD dashboard: assignment counts scoped to this user (see JSDoc on return fields).
 */
async function getCadDashboardStats(cadUser) {
  const uid = cadUser._id;
  const touched = { $or: [{ assignedTo: uid }, { rejectedByCad: uid }] };

  const [
    totalOrders,
    inProgressOrders,
    acceptedOrders,
    rejectedOrders,
  ] = await Promise.all([
    SurveySketchAssignment.countDocuments(touched),
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
      status: {
        $in: [
          SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
          SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
          SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
        ],
      },
    }),
    SurveySketchAssignment.countDocuments({
      rejectedByCad: uid,
      status: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
    }),
  ]);

  return {
    totalOrders,
    acceptedOrders,
    rejectedOrders,
    inProgressOrders,
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
};
