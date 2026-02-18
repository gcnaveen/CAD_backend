/**
 * Surveyor Sketch Upload Service
 * Create and list survey sketch submissions (surveyor-only create; list own).
 */

const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const User = require("../models/user/User");
const { USER_ROLES } = require("../config/constants");
const { ForbiddenError, NotFoundError } = require("../utils/errors");

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

  const doc = new SurveyorSketchUpload({
    surveyor: surveyor._id,
    surveyType: payload.surveyType,
    district: payload.district,
    taluka: payload.taluka,
    hobli: payload.hobli,
    village: payload.village,
    surveyNo: payload.surveyNo,
    documents: new Map(Object.entries(payload.documents)),
    others: payload.others ?? null,
  });

  await doc.save();

  return doc.toJSON ? doc.toJSON() : doc;
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
 * List uploads. Surveyor: only own; Admin/SuperAdmin: all (optional filter by surveyor).
 * @param {Object} actor - Authenticated user
 * @param {{ page?: number, limit?: number, status?: string, surveyorId?: string }} options
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

module.exports = {
  create,
  getById,
  list,
};
