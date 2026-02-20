/**
 * Hobli service – maps to both District and Taluka (District → Taluka → Hobli).
 * Validates taluka exists and belongs to district; sets districtId from taluka; enforces unique (talukaId + code).
 */

const Hobli = require("../../models/masters/Hobli");
const talukaService = require("./taluka.service");
const districtService = require("./district.service");
const { NotFoundError, ConflictError, BadRequestError } = require("../../utils/errors");
const mongoose = require("mongoose");

async function create(payload) {
  let talukaId = payload.talukaId;
  let districtId = payload.districtId;

  if (!talukaId && payload.talukaName) {
    if (!payload.districtName && !payload.districtId) {
      throw new NotFoundError("District name or ID required to find taluka by name", { code: "DISTRICT_REQUIRED" });
    }
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
    if (!districtId) districtId = taluka.districtId;
  }

  if (!talukaId) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }

  const taluka = await talukaService.getById(talukaId);
  if (!taluka) {
    throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  }
  // getById returns populated districtId (object); get raw ID for comparison and storage
  const talukaDistrictId = taluka.districtId && (taluka.districtId._id != null ? taluka.districtId._id : taluka.districtId);
  if (!talukaDistrictId) {
    throw new BadRequestError("Taluka has no district; cannot create Hobli", { code: "DISTRICT_REQUIRED" });
  }
  districtId = districtId || talukaDistrictId;
  if (!districtId) {
    throw new BadRequestError("District is required for Hobli", { code: "DISTRICT_REQUIRED" });
  }
  // Normalize to string for comparison (handle ObjectId or string, avoid CastError)
  const talukaDistrictStr = String(talukaDistrictId.toString ? talukaDistrictId.toString() : talukaDistrictId);
  let districtIdStr;
  try {
    districtIdStr = mongoose.Types.ObjectId.isValid(districtId) ? new mongoose.Types.ObjectId(districtId).toString() : String(districtId);
  } catch (_) {
    throw new BadRequestError("Invalid district ID", { code: "INVALID_DISTRICT_ID" });
  }
  if (talukaDistrictStr !== districtIdStr) {
    throw new BadRequestError("Taluka does not belong to the given district", { code: "TALUKA_DISTRICT_MISMATCH" });
  }

  const districtIdForDoc = districtId instanceof mongoose.Types.ObjectId ? districtId : new mongoose.Types.ObjectId(districtId);
  const talukaIdForDoc = talukaId instanceof mongoose.Types.ObjectId ? talukaId : new mongoose.Types.ObjectId(talukaId);
  const doc = new Hobli({
    districtId: districtIdForDoc,
    talukaId: talukaIdForDoc,
    code: payload.code,
    name: payload.name,
    status: payload.status ?? "ACTIVE",
  });
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
    .populate("districtId", "code name")
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
    .populate("districtId", "code name")
    .populate("talukaId", "code name districtId")
    .lean();
  if (!hobli) {
    throw new NotFoundError(`Hobli not found: ${name}`, { code: "HOBLI_NOT_FOUND" });
  }
  return hobli;
}

async function listByDistrict(districtId, filters = {}, pagination = null) {
  const query = { districtId };
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  if (!pagination) {
    return Hobli.find(query).populate("districtId", "code name").populate("talukaId", "code name").sort(sort).lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    Hobli.find(query).populate("districtId", "code name").populate("talukaId", "code name").sort(sort).skip(skip).limit(limit).lean(),
    Hobli.countDocuments(query),
  ]);
  return { data, total };
}

async function listByTaluka(talukaId, filters = {}, pagination = null) {
  const query = { talukaId };
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  if (!pagination) {
    return Hobli.find(query).populate("districtId", "code name").populate("talukaId", "code name").sort(sort).lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    Hobli.find(query).populate("districtId", "code name").populate("talukaId", "code name").sort(sort).skip(skip).limit(limit).lean(),
    Hobli.countDocuments(query),
  ]);
  return { data, total };
}

async function list(filters = {}, pagination = null) {
  const query = {};
  if (filters.districtId) query.districtId = filters.districtId;
  if (filters.talukaId) query.talukaId = filters.talukaId;
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  const baseQuery = () =>
    Hobli.find(query)
      .populate("districtId", "code name")
      .populate("talukaId", "code name districtId")
      .sort(sort);
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
  listByDistrict,
  listByTaluka,
  list,
  update,
};
