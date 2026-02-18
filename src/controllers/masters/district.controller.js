/**
 * District controller – HTTP layer for District CRUD.
 */

const districtService = require("../../services/masters/district.service");
const { ok, created } = require("../../utils/response");

async function createDistrict(payload) {
  const data = await districtService.create(payload);
  return created(data);
}

async function getDistrict(id) {
  const data = await districtService.getById(id);
  return ok(data);
}

async function listDistricts(filters) {
  const data = await districtService.list(filters);
  return ok(data);
}

async function updateDistrict(id, updates) {
  const data = await districtService.update(id, updates);
  return ok(data);
}

module.exports = {
  createDistrict,
  getDistrict,
  listDistricts,
  updateDistrict,
};
