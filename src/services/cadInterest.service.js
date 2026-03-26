const CadInterest = require("../models/cadInterest/CadInterest");

async function list({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;

  const [data, total] = await Promise.all([
    CadInterest.find({}).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    CadInterest.countDocuments({}),
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

module.exports = {
  list,
  create,
};

