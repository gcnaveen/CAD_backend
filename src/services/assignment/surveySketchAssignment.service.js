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
const { USER_ROLES, USER_STATUS, SURVEY_SKETCH_ASSIGNMENT_STATUS, SURVEY_SKETCH_STATUS } = require("../../config/constants");

function idFromRef(ref) {
  if (ref == null) return null;
  return ref._id != null ? ref._id : ref;
}

async function getNotificationCadUserIds(assignmentDoc) {
  const assignedId = idFromRef(assignmentDoc?.assignedTo);
  if (assignedId) return [assignedId];
  if (assignmentDoc?.cadCenter) return getCadUserIdsByCenter(assignmentDoc.cadCenter);
  return [];
}

async function getCadUserIdsByCenter(cadCenterId) {
  const users = await User.find({
    role: USER_ROLES.CAD,
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
    "cadProfile.cadCenter": cadCenterId,
  })
    .select("_id")
    .lean();
  return users.map((u) => u._id);
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
    const cadUserIds = await getNotificationCadUserIds(assignmentDoc);
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
    status: { $nin: [SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED] },
  }).lean();

  if (existing) {
    throw new ConflictError(
      "This survey sketch is already assigned. Cancel the existing assignment first or reassign via update.",
      { code: "ALREADY_ASSIGNED", assignmentId: existing._id }
    );
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
 * Update assignment status (and optional assignedTo, dueDate, notes).
 */
async function update(assignmentId, updates, actor) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }

  const allowed = {};
  if (updates.status && Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS).includes(updates.status)) {
    allowed.status = updates.status;
    if (updates.status === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
      allowed.completedAt = new Date();
    }
  }
  // assignedToUserId – commented out for now; uncomment if assigning to a specific CAD user is required
  // if (updates.assignedTo !== undefined) allowed.assignedTo = updates.assignedTo || null;
  if (updates.dueDate !== undefined) allowed.dueDate = updates.dueDate ? new Date(updates.dueDate) : null;
  if (updates.notes !== undefined) allowed.notes = updates.notes ? String(updates.notes).trim().slice(0, 1000) : null;

  Object.assign(doc, allowed);
  await doc.save();

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
  await notifyAssignmentEvent({
    type: "SURVEY_SKETCH_ASSIGNMENT_UPDATED",
    title: "Assignment updated",
    message: `Assignment status updated to ${doc.status}.`,
    assignmentDoc: populated || doc,
    createdBy: actor?._id,
  });
  return populated;
}

const CAD_ASSIGNMENT_RESPONSE_ACTION = Object.freeze({ ACCEPT: "accept", REJECT: "reject" });

/**
 * Accept or reject an assignment (CAD user only).
 * Accept: status ASSIGNED → IN_PROGRESS, assignedTo = cadUser (if not already set).
 * Reject: status → CANCELLED, survey sketch status → PENDING (so admin can reassign).
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

  if (doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED) {
    throw new BadRequestError(
      `Only assignments with status ASSIGNED can be accepted or rejected. Current status: ${doc.status}`,
      { code: "INVALID_STATUS_FOR_RESPONSE", currentStatus: doc.status }
    );
  }

  const isAccept = action === CAD_ASSIGNMENT_RESPONSE_ACTION.ACCEPT;

  if (isAccept) {
    doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS;
    if (!doc.assignedTo) {
      doc.assignedTo = cadUser._id;
    }
    await doc.save();
  } else {
    doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED;
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
    status: { $nin: [SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED] },
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
 * CAD uploads finished sketch URL (after presign PUT). Sets upload.cadDeliverable, assignment COMPLETED, sketch CAD_DELIVERED.
 */
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
  if (doc.status !== SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS) {
    throw new BadRequestError(
      `Deliverable can only be submitted while assignment is IN_PROGRESS. Current: ${doc.status}`,
      { code: "INVALID_STATUS_FOR_DELIVER", currentStatus: doc.status }
    );
  }

  const uploadId = doc.surveyorSketchUpload;
  const cadDeliverable = {
    url: String(fileMeta.url).trim(),
    fileName: fileMeta.fileName != null ? String(fileMeta.fileName).trim() : null,
    mimeType: fileMeta.mimeType != null ? String(fileMeta.mimeType).trim() : null,
    size: fileMeta.size != null && fileMeta.size !== "" ? Number(fileMeta.size) : null,
    uploadedAt: new Date(),
  };

  await SurveyorSketchUpload.findByIdAndUpdate(uploadId, {
    cadDeliverable,
    status: SURVEY_SKETCH_STATUS.CAD_DELIVERED,
  });

  doc.status = SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED;
  doc.completedAt = new Date();
  await doc.save();

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

module.exports = {
  create,
  listByCadCenter,
  listForCadUser,
  getAssignmentCountsByCenter,
  getById,
  update,
  respondToAssignment,
  deliverCadSketch,
  listAll,
  autoAssignFromFlow,
};
