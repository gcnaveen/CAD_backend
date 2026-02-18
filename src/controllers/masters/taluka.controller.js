/**
 * Taluka controller – HTTP layer for Taluka CRUD (under District).
 */

const talukaService = require("../../services/masters/taluka.service");
const { ok, created } = require("../../utils/response");

async function createTaluka(payload) {
  const data = await talukaService.create(payload);
  return created(data);
}

async function getTaluka(id) {
  const data = await talukaService.getById(id);
  return ok(data);
}

async function listTalukas(districtIdOrName, filters, pagination) {
  const mongoose = require("mongoose");
  const { paginationMeta } = require("../../utils/pagination");
  let result;
  if (districtIdOrName && mongoose.Types.ObjectId.isValid(districtIdOrName)) {
    result = await talukaService.listByDistrict(districtIdOrName, filters || {}, pagination);
  } else if (districtIdOrName) {
    const districtService = require("../../services/masters/district.service");
    const district = await districtService.findByName(districtIdOrName);
    if (!district) {
      const { NotFoundError } = require("../../utils/errors");
      throw new NotFoundError(`District not found: ${districtIdOrName}`, { code: "DISTRICT_NOT_FOUND" });
    }
    result = await talukaService.listByDistrict(district._id, filters || {}, pagination);
  } else {
    result = await talukaService.list(filters || {}, pagination);
  }
  if (!pagination) {
    return ok(result);
  }
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
}

async function updateTaluka(id, updates) {
  const data = await talukaService.update(id, updates);
  return ok(data);
}

module.exports = {
  createTaluka,
  getTaluka,
  listTalukas,
  updateTaluka,
};
