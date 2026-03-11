const Quote = require("../../models/quote/Quote");
const { USER_ROLES, QUOTE_STATUS } = require("../../config/constants");
const { parsePagination } = require("../../utils/pagination");
const { BadRequestError, ForbiddenError, NotFoundError } = require("../../utils/errors");

function normalizeFlagsAndStatus(input = {}, current = null) {
  const out = { ...input };

  const hasDraft = Object.prototype.hasOwnProperty.call(out, "draft");
  const hasConfirmed = Object.prototype.hasOwnProperty.call(out, "confirmed");

  if (hasConfirmed && out.confirmed === true) {
    out.draft = false;
  }
  if (hasDraft && out.draft === true) {
    out.confirmed = false;
  }

  const effectiveDraft = hasDraft ? out.draft : current?.draft;
  const effectiveConfirmed = hasConfirmed ? out.confirmed : current?.confirmed;

  if (effectiveDraft === true && effectiveConfirmed === true) {
    throw new BadRequestError("draft and confirmed cannot both be true", {
      errors: [
        { field: "draft", message: "Cannot be true when confirmed is true" },
        { field: "confirmed", message: "Cannot be true when draft is true" },
      ],
    });
  }

  if (!Object.prototype.hasOwnProperty.call(out, "status")) {
    if (effectiveDraft === true) out.status = QUOTE_STATUS.DRAFT;
    else if (effectiveConfirmed === true && current?.status === QUOTE_STATUS.DRAFT) out.status = QUOTE_STATUS.SHARED;
    else if (effectiveConfirmed === true && !current) out.status = QUOTE_STATUS.SHARED;
  }

  return out;
}

function canAccess(actor, quote) {
  if (actor.role === USER_ROLES.SUPER_ADMIN || actor.role === USER_ROLES.ADMIN) return true;
  return String(quote.createdBy) === String(actor._id);
}

async function create(actor, payload) {
  const normalized = normalizeFlagsAndStatus(payload);
  const doc = await Quote.create({
    ...normalized,
    createdBy: actor._id,
  });
  return doc.toObject();
}

async function getById(actor, quoteId) {
  const doc = await Quote.findById(quoteId).lean();
  if (!doc) throw new NotFoundError("Quote not found");
  if (!canAccess(actor, doc)) throw new ForbiddenError("You can only access your own quotes");
  return doc;
}

async function list(actor, query = {}) {
  const pagination = parsePagination(query) || { page: 1, limit: 20, skip: 0 };
  const filter = {};

  if (actor.role !== USER_ROLES.SUPER_ADMIN && actor.role !== USER_ROLES.ADMIN) {
    filter.createdBy = actor._id;
  } else if (query.createdBy) {
    filter.createdBy = query.createdBy;
  }

  if (query.leadId) filter.leadId = query.leadId;
  if (query.venueId) filter.venueId = query.venueId;
  if (query.bookingType) filter.bookingType = query.bookingType;
  if (query.status) filter.status = query.status;
  if (query.draft !== undefined) filter.draft = query.draft;
  if (query.confirmed !== undefined) filter.confirmed = query.confirmed;

  const [data, total] = await Promise.all([
    Quote.find(filter).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
    Quote.countDocuments(filter),
  ]);

  return {
    data,
    meta: {
      page: pagination.page,
      limit: pagination.limit,
      total,
    },
  };
}

async function patch(actor, quoteId, updates) {
  const existing = await Quote.findById(quoteId);
  if (!existing) throw new NotFoundError("Quote not found");
  if (!canAccess(actor, existing)) throw new ForbiddenError("You can only update your own quotes");

  const normalized = normalizeFlagsAndStatus(updates, existing.toObject());
  Object.assign(existing, normalized);
  await existing.save();
  return existing.toObject();
}

module.exports = {
  create,
  getById,
  list,
  patch,
};
