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

async function listDistricts(filters, pagination) {
  const result = await districtService.list(filters, pagination);
  if (!pagination) {
    return ok(result);
  }
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
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
