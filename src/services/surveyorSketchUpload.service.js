/**
 * Surveyor Sketch Upload Service
 * Create and list survey sketch submissions (surveyor-only create; list own).
 */

const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const User = require("../models/user/User");
const District = require("../models/masters/District");
const Taluka = require("../models/masters/Taluka");
const Hobli = require("../models/masters/Hobli");
const Village = require("../models/masters/Village");
const { USER_ROLES } = require("../config/constants");
const { ForbiddenError, NotFoundError, BadRequestError } = require("../utils/errors");
const mongoose = require("mongoose");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Create a new survey sketch upload. Surveyor must be the authenticated user.
 * @param {Object} surveyor - Authenticated user (must have role SURVEYOR)
 * @param {Object} payload - Validated payload from schemas.surveyorSketchUploadCreate
 * @returns {Promise<Object>} Created document (with populated refs if needed)
 */
async function create(surveyor, payload) {
  if (surveyor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can submit sketch uploads");
  }

  // Validate that district, taluka, hobli, village exist before creating
  const [district, taluka, hobli, village] = await Promise.all([
    District.findById(payload.district).lean(),
    Taluka.findById(payload.taluka).lean(),
    Hobli.findById(payload.hobli).lean(),
    Village.findById(payload.village).lean(),
  ]);

  if (!district) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }
  if (!taluka) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }
  if (!hobli) {
    throw new NotFoundError("Hobli not found", { code: "HOBLI_NOT_FOUND" });
  }
  if (!village) {
    throw new NotFoundError("Village not found", { code: "VILLAGE_NOT_FOUND" });
  }

  // Validate hierarchy: taluka belongs to district, hobli belongs to taluka, village belongs to hobli
  const talukaDistrictId = taluka.districtId?.toString ? taluka.districtId.toString() : String(taluka.districtId);
  const districtIdStr = String(payload.district);
  if (talukaDistrictId !== districtIdStr) {
    throw new BadRequestError("Taluka does not belong to the given district", {
      code: "TALUKA_DISTRICT_MISMATCH",
    });
  }

  const hobliTalukaId = hobli.talukaId?.toString ? hobli.talukaId.toString() : String(hobli.talukaId);
  const talukaIdStr = String(payload.taluka);
  if (hobliTalukaId !== talukaIdStr) {
    throw new BadRequestError("Hobli does not belong to the given taluka", {
      code: "HOBLI_TALUKA_MISMATCH",
    });
  }

  const villageHobliId = village.hobliId?.toString ? village.hobliId.toString() : String(village.hobliId);
  const hobliIdStr = String(payload.hobli);
  if (villageHobliId !== hobliIdStr) {
    throw new BadRequestError("Village does not belong to the given hobli", {
      code: "VILLAGE_HOBLI_MISMATCH",
    });
  }

  const doc = new SurveyorSketchUpload({
    surveyor: surveyor._id,
    surveyType: payload.surveyType,
    district: payload.district,
    taluka: payload.taluka,
    hobli: payload.hobli,
    village: payload.village,
    surveyNo: payload.surveyNo,
    documents: new Map(Object.entries(payload.documents)),
    audio: payload.audio || null,
    other_documents: Array.isArray(payload.other_documents) ? payload.other_documents : [],
    others: payload.others ?? null,
  });

  try {
    await doc.save();
    return doc.toJSON ? doc.toJSON() : doc;
  } catch (err) {
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
  const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
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

  const assignmentByUploadId = {};
  assignments.forEach((a) => {
    const id = a.surveyorSketchUpload?.toString?.() || String(a.surveyorSketchUpload);
    assignmentByUploadId[id] = a;
  });

  const data = uploads.map((upload) => ({
    ...upload,
    assignment: assignmentByUploadId[upload._id.toString()] || null,
  }));

  return {
    data,
    meta: { page, limit, total },
  };
}

module.exports = {
  create,
  getById,
  list,
  listAllWithAssignment,
};
