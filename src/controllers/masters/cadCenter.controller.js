/**
 * CAD Center controller – HTTP layer for CAD center CRUD.
 */

const cadCenterService = require("../../services/masters/cadCenter.service");
const { ok, created } = require("../../utils/response");

async function createCadCenter(payload, creator) {
  const data = await cadCenterService.create(payload, creator?._id);
  return created(data);
}

async function getCadCenter(id, options = {}) {
  const data = options.includeAssignments
    ? await cadCenterService.getByIdWithAssignments(id, options)
    : await cadCenterService.getById(id);
  return ok(data);
}

async function listCadCenters(filters, pagination, options = {}) {
  const result = await cadCenterService.list(filters, pagination, options);
  if (!pagination) {
    return ok(Array.isArray(result) ? result : result.data);
  }
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
}

async function updateCadCenter(id, payload) {
  const data = await cadCenterService.update(id, payload);
  return ok(data);
}

async function deleteCadCenter(id) {
  const data = await cadCenterService.remove(id);
  return ok(data);
}

module.exports = {
  createCadCenter,
  getCadCenter,
  listCadCenters,
  updateCadCenter,
  deleteCadCenter,
};
