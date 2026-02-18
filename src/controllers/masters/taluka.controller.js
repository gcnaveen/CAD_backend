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

async function listTalukas(districtIdOrName, filters) {
  const mongoose = require("mongoose");
  let data;
  if (districtIdOrName && mongoose.Types.ObjectId.isValid(districtIdOrName)) {
    // Use districtId
    data = await talukaService.listByDistrict(districtIdOrName, filters || {});
  } else if (districtIdOrName) {
    // Look up district by name first
    const districtService = require("../../services/masters/district.service");
    const district = await districtService.findByName(districtIdOrName);
    if (!district) {
      const { NotFoundError } = require("../../utils/errors");
      throw new NotFoundError(`District not found: ${districtIdOrName}`, { code: "DISTRICT_NOT_FOUND" });
    }
    data = await talukaService.listByDistrict(district._id, filters || {});
  } else {
    // List all talukas
    data = await talukaService.list(filters || {});
  }
  return ok(data);
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
