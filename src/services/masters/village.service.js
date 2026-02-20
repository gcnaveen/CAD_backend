/**
 * Village service – maps to District, Taluka and Hobli (District → Taluka → Hobli → Village).
 * Validates hierarchy: hobli belongs to taluka, taluka belongs to district.
 */

const Village = require("../../models/masters/Village");
const Hobli = require("../../models/masters/Hobli");
const talukaService = require("./taluka.service");
const hobliService = require("./hobli.service");
const districtService = require("./district.service");
const { NotFoundError, ConflictError, BadRequestError } = require("../../utils/errors");
const mongoose = require("mongoose");

/** Get comparable string ID from raw ObjectId or populated ref { _id, ... } */
function toIdStr(val) {
  if (val == null) return null;
  if (val._id != null) return String(val._id);
  return String(val.toString ? val.toString() : val);
}

async function create(payload) {
  const { districtId, talukaId, hobliId } = payload;

  if (!districtId || !talukaId || !hobliId) {
    throw new BadRequestError("districtId, talukaId and hobliId are required", {
      code: "MISSING_PARENTS",
      errors: [
        { field: "districtId", message: "Required" },
        { field: "talukaId", message: "Required" },
        { field: "hobliId", message: "Required" },
      ],
    });
  }

  const [district, taluka, hobli] = await Promise.all([
    districtService.getById(districtId),
    talukaService.getById(talukaId),
    hobliService.getById(hobliId),
  ]);

  if (!district) throw new NotFoundError("District not found", { code: "DISTRICT_NOT_FOUND" });
  if (!taluka) throw new NotFoundError("Taluka not found", { code: "TALUKA_NOT_FOUND" });
  if (!hobli) throw new NotFoundError("Hobli not found", { code: "HOBLI_NOT_FOUND" });

  const districtStr = toIdStr(districtId);
  const talukaStr = toIdStr(talukaId);
  const talukaDistrictStr = toIdStr(taluka.districtId);
  const hobliTalukaStr = toIdStr(hobli.talukaId);
  const hobliDistrictStr = toIdStr(hobli.districtId);

  if (talukaDistrictStr !== districtStr) {
    throw new BadRequestError("Taluka does not belong to the given district", {
      code: "TALUKA_DISTRICT_MISMATCH",
    });
  }
  if (hobliTalukaStr !== talukaStr) {
    throw new BadRequestError("Hobli does not belong to the given taluka", {
      code: "HOBLI_TALUKA_MISMATCH",
    });
  }
  if (hobliDistrictStr != null && hobliDistrictStr !== districtStr) {
    throw new BadRequestError("Hobli does not belong to the given district", {
      code: "HOBLI_DISTRICT_MISMATCH",
    });
  }

  const doc = new Village({
    districtId,
    talukaId,
    hobliId,
    code: payload.code,
    name: payload.name,
    status: payload.status,
  });

  try {
    await doc.save();
    return doc.toObject();
  } catch (err) {
    if (err.code === 11000) {
      throw new ConflictError("Village with this code already exists in this hobli", {
        code: "DUPLICATE_CODE",
        errors: [{ field: "code", message: "Already exists for this hobli" }],
      });
    }
    throw err;
  }
}

async function getById(id) {
  const village = await Village.findById(id)
    .populate("districtId", "code name")
    .populate("talukaId", "code name districtId")
    .populate("hobliId", "code name districtId talukaId")
    .lean();
  if (!village) {
    throw new NotFoundError("Village not found", { code: "VILLAGE_NOT_FOUND" });
  }
  return village;
}

async function list(filters = {}, pagination = null) {
  const query = {};
  if (filters.districtId) query.districtId = filters.districtId;
  if (filters.talukaId) query.talukaId = filters.talukaId;
  if (filters.hobliId) query.hobliId = filters.hobliId;
  if (filters.status) query.status = filters.status;

  const sort = { name: 1 };
  const baseQuery = () =>
    Village.find(query)
      .populate("districtId", "code name")
      .populate("talukaId", "code name")
      .populate("hobliId", "code name")
      .sort(sort);

  if (!pagination) {
    return baseQuery().lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    baseQuery().skip(skip).limit(limit).lean(),
    Village.countDocuments(query),
  ]);
  return { data, total };
}

async function listByHobli(hobliId, filters = {}, pagination = null) {
  const query = { hobliId };
  if (filters.status) query.status = filters.status;
  const sort = { name: 1 };
  if (!pagination) {
    return Village.find(query)
      .populate("districtId", "code name")
      .populate("talukaId", "code name")
      .populate("hobliId", "code name")
      .sort(sort)
      .lean();
  }
  const { skip, limit } = pagination;
  const [data, total] = await Promise.all([
    Village.find(query)
      .populate("districtId", "code name")
      .populate("talukaId", "code name")
      .populate("hobliId", "code name")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Village.countDocuments(query),
  ]);
  return { data, total };
}

async function update(id, updates) {
  const allowed = ["code", "name", "status"];
  const sanitized = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) sanitized[key] = updates[key];
  }
  if (Object.keys(sanitized).length === 0) {
    throw new BadRequestError("No allowed fields to update (code, name, status)");
  }

  const village = await Village.findByIdAndUpdate(
    id,
    { $set: sanitized },
    { new: true, runValidators: true }
  )
    .populate("districtId", "code name")
    .populate("talukaId", "code name")
    .populate("hobliId", "code name")
    .lean();

  if (!village) {
    throw new NotFoundError("Village not found", { code: "VILLAGE_NOT_FOUND" });
  }
  return village;
}

module.exports = {
  create,
  getById,
  list,
  listByHobli,
  update,
};
