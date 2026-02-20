/**
 * Village controller – HTTP layer for Village CRUD (under District → Taluka → Hobli).
 */

const villageService = require("../../services/masters/village.service");
const { ok, created } = require("../../utils/response");

async function createVillage(payload) {
  const data = await villageService.create(payload);
  return created(data);
}

async function getVillage(id) {
  const data = await villageService.getById(id);
  return ok(data);
}

async function listVillages(filters, pagination) {
  const result = await villageService.list(filters, pagination);
  if (!pagination) {
    return ok(result);
  }
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
}

async function listVillagesByHobli(hobliId, filters, pagination) {
  const result = await villageService.listByHobli(hobliId, filters || {}, pagination);
  if (!pagination) {
    return ok(result);
  }
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
}

async function updateVillage(id, payload) {
  const data = await villageService.update(id, payload);
  return ok(data);
}

module.exports = {
  createVillage,
  getVillage,
  listVillages,
  listVillagesByHobli,
  updateVillage,
};
