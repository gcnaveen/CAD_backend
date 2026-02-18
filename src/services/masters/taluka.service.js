/**
 * Taluka service – belongs to District (District → Taluka → Hobli).
 * Validates districtId exists before create; enforces unique (districtId + code).
 */

const Taluka = require("../../models/masters/Taluka");
const districtService = require("./district.service");
const { NotFoundError, ConflictError } = require("../../utils/errors");
const mongoose = require("mongoose");

async function create(payload) {
  // If districtId is provided, use it; otherwise look up by district name
  let districtId = payload.districtId;
  if (!districtId && payload.districtName) {
    const district = await districtService.findByName(payload.districtName);
    if (!district) {
      throw new NotFoundError(`District not found: ${payload.districtName}`, { code: "DISTRICT_NOT_FOUND" });
    }
    districtId = district._id;
  }
  
  if (!districtId) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }

  const districtExists = await districtService.exists(districtId);
  if (!districtExists) {
    throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  }

  const doc = new Taluka({ ...payload, districtId });
  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("Taluka with this code already exists in this district", {
        code: "DUPLICATE_CODE",
        errors: [{ field: "code", message: "Already exists for this district" }],
      });
    }
    throw err;
  }
}

async function getById(id) {
  const taluka = await Taluka.findById(id).populate("districtId", "code name").lean();
  if (!taluka) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }
  return taluka;
}

async function getByName(name, districtName) {
  let districtId = null;
  if (districtName) {
    const district = await districtService.findByName(districtName);
    if (!district) {
      throw new NotFoundError(`District not found: ${districtName}`, { code: "DISTRICT_NOT_FOUND" });
    }
    districtId = district._id;
  }
  
  const query = { name: { $regex: new RegExp(`^${name.trim()}$`, "i") } };
  if (districtId) query.districtId = districtId;
  
  const taluka = await Taluka.findOne(query).populate("districtId", "code name").lean();
  if (!taluka) {
    throw new NotFoundError(`Taluka not found: ${name}`, { code: "TALUKA_NOT_FOUND" });
  }
  return taluka;
}

async function listByDistrict(districtId, filters = {}) {
  const query = { districtId };
  if (filters.status) query.status = filters.status;
  return Taluka.find(query).sort({ name: 1 }).lean();
}

async function list(filters = {}) {
  const query = {};
  if (filters.districtId) {
    query.districtId = filters.districtId;
  }
  if (filters.status) query.status = filters.status;
  return Taluka.find(query).populate("districtId", "code name").sort({ name: 1 }).lean();
}

async function update(id, updates) {
  const taluka = await Taluka.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!taluka) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }
  return taluka;
}

async function exists(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  const count = await Taluka.countDocuments({ _id: id }).limit(1);
  return count > 0;
}

async function findByName(name, districtId) {
  const taluka = await Taluka.findOne({ 
    name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
    districtId 
  }).lean();
  return taluka;
}

module.exports = {
  create,
  getById,
  getByName,
  listByDistrict,
  list,
  update,
  exists,
  findByName,
};
