/**
 * Survey Sketch Assignment service – assign survey sketches to CAD centers (admin).
 * Production: validate sketch and center exist, enforce one active assignment per sketch (optional), audit trail.
 */

const SurveySketchAssignment = require("../../models/assignment/SurveySketchAssignment");
const SurveyorSketchUpload = require("../../models/surveyor/SurveyorSketchUpload");
const CadCenter = require("../../models/masters/CadCenter");
const User = require("../../models/user/User");
const {
  NotFoundError,
  ConflictError,
  BadRequestError,
  ForbiddenError,
} = require("../../utils/errors");
const { USER_ROLES, SURVEY_SKETCH_ASSIGNMENT_STATUS, SURVEY_SKETCH_STATUS } = require("../../config/constants");

/**
 * Create an assignment: survey sketch → CAD center (optional: specific CAD user).
 * Admin only. Validates sketch and center exist; optionally cancels previous assignment for same sketch.
 */
async function create(payload, assignedBy) {
  const { surveyorSketchUploadId, cadCenterId, dueDate, notes } = payload;
  // assignedToUserId – commented out for now; uncomment if assigning to a specific CAD user is required
  // const { surveyorSketchUploadId, cadCenterId, assignedToUserId, dueDate, notes } = payload;

  const [sketch, center] = await Promise.all([
    SurveyorSketchUpload.findById(surveyorSketchUploadId).lean(),
    CadCenter.findOne({ _id: cadCenterId, deletedAt: null }).lean(),
  ]);

  if (!sketch) {
    throw new NotFoundError("Survey sketch upload not found", {
      code: "SURVEY_SKETCH_NOT_FOUND",
    });
  }
  if (!center) {
    throw new NotFoundError("CAD center not found", { code: "CAD_CENTER_NOT_FOUND" });
  }

  // assignedToUserId validation – commented out for now
  // if (assignedToUserId) {
  //   const cadUser = await User.findOne({
  //     _id: assignedToUserId,
  //     role: USER_ROLES.CAD,
  //     deletedAt: null,
  //     "cadProfile.cadCenter": cadCenterId,
  //   }).lean();
  //   if (!cadUser) {
  //     throw new BadRequestError("Assigned user must be a CAD user belonging to this center", {
  //       code: "INVALID_ASSIGNED_USER",
  //     });
  //   }
  // }

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
    cadCenter: cadCenterId,
    assignedTo: null, // assignedToUserId – commented out for now; was: assignedToUserId || null
    status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    assignedBy: assignedBy._id,
    dueDate: dueDate ? new Date(dueDate) : null,
    notes: notes ? String(notes).trim().slice(0, 1000) : null,
  });

  await doc.save();

  // When admin assigns, update survey sketch status from PENDING → ASSIGNED
  await SurveyorSketchUpload.findByIdAndUpdate(surveyorSketchUploadId, {
    status: SURVEY_SKETCH_STATUS.ASSIGNED,
  });

  const populated = await SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
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
  return SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
}

const CAD_ASSIGNMENT_RESPONSE_ACTION = Object.freeze({ ACCEPT: "accept", REJECT: "reject" });

/**
 * Accept or reject an assignment (CAD user only).
 * Accept: status ASSIGNED → IN_PROGRESS, assignedTo = cadUser.
 * Reject: status → CANCELLED, survey sketch status → PENDING (so admin can reassign).
 * CAD user must belong to the assignment's CAD center.
 */
async function respondToAssignment(assignmentId, cadUser, action) {
  const doc = await SurveySketchAssignment.findById(assignmentId);
  if (!doc) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }

  const userCenterId =
    cadUser.cadProfile?.cadCenter != null ? String(cadUser.cadProfile.cadCenter) : null;
  if (!userCenterId) {
    throw new ForbiddenError("CAD user must be linked to a CAD center to respond to work", {
      code: "CAD_CENTER_NOT_LINKED",
    });
  }

  const assignmentCenterId = doc.cadCenter != null ? String(doc.cadCenter) : null;
  if (!assignmentCenterId || userCenterId !== assignmentCenterId) {
    throw new ForbiddenError("You can only respond to assignments for your CAD center", {
      code: "ASSIGNMENT_NOT_FOR_YOUR_CENTER",
    });
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
    doc.assignedTo = cadUser._id;
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

  return SurveySketchAssignment.findById(doc._id)
    .populate("surveyorSketchUpload", "applicationId surveyNo status")
    .populate("cadCenter", "name code")
    .populate("assignedTo", "name auth")
    .populate("assignedBy", "name")
    .lean();
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

module.exports = {
  create,
  listByCadCenter,
  getAssignmentCountsByCenter,
  getById,
  update,
  respondToAssignment,
  listAll,
};
