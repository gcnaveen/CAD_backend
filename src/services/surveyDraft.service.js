const SurveyDraft = require("../models/surveyor/SurveyDraft");
const { USER_ROLES } = require("../config/constants");
const { ForbiddenError, NotFoundError } = require("../utils/errors");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const notDeleted = { deletedAt: null };

function assertReadAccess(actor, draft) {
  if (actor.role === USER_ROLES.SUPER_ADMIN || actor.role === USER_ROLES.ADMIN) return;
  if (actor.role !== USER_ROLES.SURVEYOR) throw new ForbiddenError("Insufficient permissions");
  if (String(draft.surveyor) !== String(actor._id)) {
    throw new ForbiddenError("You can only access your own drafts");
  }
}

async function create(actor, payload) {
  if (actor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can save drafts");
  }
  const doc = await SurveyDraft.create({
    ...payload,
    surveyor: actor._id,
    documents: new Map(Object.entries(payload.documents || {})),
  });
  return doc.toObject();
}

async function getById(actor, draftId) {
  const doc = await SurveyDraft.findOne({ _id: draftId, ...notDeleted })
    .populate("surveyor", "name role")
    .populate("district", "code name")
    .populate("taluka", "code name")
    .populate("hobli", "code name")
    .populate("village", "code name")
    .lean();
  if (!doc) throw new NotFoundError("Survey draft not found");
  assertReadAccess(actor, doc);
  return doc;
}

async function list(actor, options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || DEFAULT_PAGE);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT));
  const skip = (page - 1) * limit;

  const filter = { ...notDeleted };
  if (actor.role === USER_ROLES.SURVEYOR) {
    filter.surveyor = actor._id;
  } else if (options.surveyorId) {
    filter.surveyor = options.surveyorId;
  }

  const [data, total] = await Promise.all([
    SurveyDraft.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("surveyor", "name role")
      .populate("district", "code name")
      .populate("taluka", "code name")
      .populate("hobli", "code name")
      .populate("village", "code name")
      .lean(),
    SurveyDraft.countDocuments(filter),
  ]);

  return { data, meta: { page, limit, total } };
}

async function update(actor, draftId, updates) {
  if (actor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can update drafts");
  }
  const doc = await SurveyDraft.findOne({ _id: draftId, ...notDeleted });
  if (!doc) throw new NotFoundError("Survey draft not found");
  if (String(doc.surveyor) !== String(actor._id)) {
    throw new ForbiddenError("You can only update your own drafts");
  }

  Object.assign(doc, updates);
  if (updates.documents) {
    doc.documents = new Map(Object.entries(updates.documents));
  }
  await doc.save();
  return doc.toObject();
}

async function remove(actor, draftId) {
  if (actor.role !== USER_ROLES.SURVEYOR) {
    throw new ForbiddenError("Only surveyors can delete drafts");
  }
  const doc = await SurveyDraft.findOne({ _id: draftId, ...notDeleted });
  if (!doc) throw new NotFoundError("Survey draft not found");
  if (String(doc.surveyor) !== String(actor._id)) {
    throw new ForbiddenError("You can only delete your own drafts");
  }
  doc.deletedAt = new Date();
  await doc.save();
  return { message: "Survey draft deleted successfully" };
}

module.exports = {
  create,
  getById,
  list,
  update,
  remove,
};
