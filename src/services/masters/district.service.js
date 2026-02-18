/**
 * District service – top-level entity in District → Taluka → Hobli hierarchy.
 * Production: lean reads, explicit 404, conflict on duplicate code.
 */

const District = require("../../models/masters/District");
const { NotFoundError, ConflictError } = require("../../utils/errors");
const mongoose = require("mongoose");

async function create(payload) {
  const doc = new District(payload);
  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("District with this code already exists", {
        code: "DUPLICATE_CODE",
        errors: [{ field: "code", message: "Already exists" }],
      });
    }
    throw err;
  }
}

async function getById(id) {
  const district = await District.findById(id).lean();
  if (!district) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }
  return district;
}

async function getByName(name) {
  const district = await findByName(name);
  if (!district) {
    throw new NotFoundError(`District not found: ${name}`, { code: "DISTRICT_NOT_FOUND" });
  }
  return district;
}

async function list(filters = {}) {
  const query = {};
  if (filters.status) query.status = filters.status;
  return District.find(query).sort({ name: 1 }).lean();
}

async function update(id, updates) {
  const district = await District.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!district) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }
  return district;
}

async function exists(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const count = await District.countDocuments({ _id: id }).limit(1);
  return count > 0;
}

async function findByName(name) {
  const district = await District.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, "i") } }).lean();
  return district;
}

module.exports = {
  create,
  getById,
  getByName,
  list,
  update,
  exists,
  findByName,
};
