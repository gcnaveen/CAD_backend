/**
 * Hobli service – belongs to Taluka (District → Taluka → Hobli).
 * Validates talukaId exists before create; enforces unique (talukaId + code).
 */

const Hobli = require("../../models/masters/Hobli");
const talukaService = require("./taluka.service");
const districtService = require("./district.service");
const { NotFoundError, ConflictError } = require("../../utils/errors");
const mongoose = require("mongoose");

async function create(payload) {
  // If talukaId is provided, use it; otherwise look up by taluka name
  let talukaId = payload.talukaId;
  if (!talukaId && payload.talukaName) {
    // Need to find taluka by name - requires district context
    if (!payload.districtName && !payload.districtId) {
      throw new NotFoundError("District name or ID required to find taluka by name", { code: "DISTRICT_REQUIRED" });
    }
    
    let districtId = payload.districtId;
    if (!districtId && payload.districtName) {
      const district = await districtService.findByName(payload.districtName);
      if (!district) {
        throw new NotFoundError(`District not found: ${payload.districtName}`, { code: "DISTRICT_NOT_FOUND" });
      }
      districtId = district._id;
    }

    const taluka = await talukaService.findByName(payload.talukaName, districtId);
    if (!taluka) {
      throw new NotFoundError(`Taluka not found: ${payload.talukaName}`, { code: "TALUKA_NOT_FOUND" });
    }
    talukaId = taluka._id;
  }
  
  if (!talukaId) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }

  const talukaExists = await talukaService.exists(talukaId);
  if (!talukaExists) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }

  const doc = new Hobli({ ...payload, talukaId });
  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("Hobli with this code already exists in this taluka", {
        code: "DUPLICATE_CODE",
        errors: [{ field: "code", message: "Already exists for this taluka" }],
      });
    }
    throw err;
  }
}

async function getById(id) {
  const hobli = await Hobli.findById(id)
    .populate("talukaId", "code name districtId")
    .lean();
  if (!hobli) {
    throw new NotFoundError("Hobli not found", { code: "HOBLI_NOT_FOUND" });
  }
  return hobli;
}

async function getByName(name, talukaName, districtName) {
  let talukaId = null;
  if (talukaName) {
    let districtId = null;
    if (districtName) {
      const district = await districtService.findByName(districtName);
      if (!district) {
        throw new NotFoundError(`District not found: ${districtName}`, { code: "DISTRICT_NOT_FOUND" });
      }
      districtId = district._id;
    }
    
    const taluka = await talukaService.findByName(talukaName, districtId);
    if (!taluka) {
      throw new NotFoundError(`Taluka not found: ${talukaName}`, { code: "TALUKA_NOT_FOUND" });
    }
    talukaId = taluka._id;
  }
  
  const query = { name: { $regex: new RegExp(`^${name.trim()}$`, "i") } };
  if (talukaId) query.talukaId = talukaId;
  
  const hobli = await Hobli.findOne(query)
    .populate("talukaId", "code name districtId")
    .lean();
  if (!hobli) {
    throw new NotFoundError(`Hobli not found: ${name}`, { code: "HOBLI_NOT_FOUND" });
  }
  return hobli;
}

async function listByTaluka(talukaId, filters = {}, pagination = null) {
  const query = { talukaId };
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  if (!pagination) {
    return Hobli.find(query).sort(sort).lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    Hobli.find(query).sort(sort).skip(skip).limit(limit).lean(),
    Hobli.countDocuments(query),
  ]);
  return { data, total };
}

async function list(filters = {}, pagination = null) {
  const query = {};
  if (filters.talukaId) query.talukaId = filters.talukaId;
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  const baseQuery = () => Hobli.find(query).populate("talukaId", "code name districtId").sort(sort);
  if (!pagination) {
    return baseQuery().lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    baseQuery().skip(skip).limit(limit).lean(),
    Hobli.countDocuments(query),
  ]);
  return { data, total };
}

async function update(id, updates) {
  const hobli = await Hobli.findByIdAndUpdate(
    id,
    { $set: updates },
    { new: true, runValidators: true }
  ).lean();
  if (!hobli) {
    throw new NotFoundError("Hobli not found", { code: "HOBLI_NOT_FOUND" });
  }
  return hobli;
}

module.exports = {
  create,
  getById,
  getByName,
  listByTaluka,
  list,
  update,
};
