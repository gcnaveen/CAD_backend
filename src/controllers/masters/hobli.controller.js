/**
 * Hobli controller – HTTP layer for Hobli CRUD (under Taluka).
 */

const hobliService = require("../../services/masters/hobli.service");
const { ok, created } = require("../../utils/response");

async function createHobli(payload) {
  const data = await hobliService.create(payload);
  return created(data);
}

async function getHobli(id) {
  const data = await hobliService.getById(id);
  return ok(data);
}

async function listHoblis(talukaIdOrName, districtName, filters) {
  const mongoose = require("mongoose");
  let data;
  if (talukaIdOrName && mongoose.Types.ObjectId.isValid(talukaIdOrName)) {
    // Use talukaId
    data = await hobliService.listByTaluka(talukaIdOrName, filters || {});
  } else if (talukaIdOrName) {
    // Look up taluka by name first
    const talukaService = require("../../services/masters/taluka.service");
    const districtService = require("../../services/masters/district.service");
    
    let districtId = null;
    if (districtName) {
      const district = await districtService.findByName(districtName);
      if (!district) {
        const { NotFoundError } = require("../../utils/errors");
        throw new NotFoundError(`District not found: ${districtName}`, { code: "DISTRICT_NOT_FOUND" });
      }
      districtId = district._id;
    }
    
    const taluka = await talukaService.findByName(talukaIdOrName, districtId);
    if (!taluka) {
      const { NotFoundError } = require("../../utils/errors");
      throw new NotFoundError(`Taluka not found: ${talukaIdOrName}`, { code: "TALUKA_NOT_FOUND" });
    }
    data = await hobliService.listByTaluka(taluka._id, filters || {});
  } else {
    // List all hoblis
    data = await hobliService.list(filters || {});
  }
  return ok(data);
}

async function updateHobli(id, updates) {
  const data = await hobliService.update(id, updates);
  return ok(data);
}

module.exports = {
  createHobli,
  getHobli,
  listHoblis,
  updateHobli,
};
