const CadInterest = require("../models/cadInterest/CadInterest");
const User = require("../models/user/User");
const { USER_ROLES } = require("../config/constants");

async function openInterestFilter() {
  const cadEmails = await User.find({
    role: USER_ROLES.CAD,
    deletedAt: null,
    "auth.email": { $exists: true, $nin: [null, ""] },
  }).distinct("auth.email");

  const filter = { convertedAt: null };
  if (cadEmails.length) {
    filter.email = { $nin: cadEmails };
  }
  return filter;
}

async function list({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;
  const filter = await openInterestFilter();

  const [data, total] = await Promise.all([
    CadInterest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    CadInterest.countDocuments(filter),
  ]);

  return {
    data,
    meta: { page: p, limit: l, total, totalPages: Math.max(1, Math.ceil(total / l)) },
  };
}

async function create(payload) {
  const { email, phone } = payload;

  const existing = await CadInterest.findOne({ email, phone });
  if (existing) {
    // Update existing submission instead of creating duplicates.
    Object.assign(existing, payload);
    await existing.save();
    return { alreadySubmitted: true, doc: existing.toObject() };
  }

  const doc = await CadInterest.create(payload);
  return { alreadySubmitted: false, doc: doc.toObject() };
}

/**
 * Mark CAD interest row(s) as onboarded when a CAD user is created with the same email.
 * @param {string} email
 * @param {import("mongoose").Types.ObjectId} userId
 */
async function markConvertedByCadUserEmail(email, userId) {
  const normalizedEmail = String(email || "").toLowerCase().trim();
  if (!normalizedEmail || !userId) return;

  await CadInterest.updateMany(
    { email: normalizedEmail, convertedAt: null },
    { $set: { convertedAt: new Date(), convertedUserId: userId } }
  );
}

module.exports = {
  list,
  create,
  markConvertedByCadUserEmail,
};
