/**
 * Survey Sketch Assignment controller – HTTP layer for admin assigning survey sketches to CAD centers.
 */

const surveySketchAssignmentService = require("../../services/assignment/surveySketchAssignment.service");
const { ok, created } = require("../../utils/response");
const { parsePagination } = require("../../utils/pagination");

async function createAssignment(actor, payload) {
  const data = await surveySketchAssignmentService.create(payload, actor);
  return created(data);
}

async function getAssignment(assignmentId) {
  const data = await surveySketchAssignmentService.getById(assignmentId);
  return ok(data);
}

async function listByCadCenter(cadCenterId, options) {
  const result = await surveySketchAssignmentService.listByCadCenter(cadCenterId, options);
  const limit = Math.min(100, Math.max(1, parseInt(options.limit, 10) || 20));
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const skip = (page - 1) * limit;
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, {
    pagination: paginationMeta({ page, limit, skip }, result.total),
  });
}

async function listAll(filters, pagination) {
  const result = await surveySketchAssignmentService.listAll(filters, pagination);
  if (!pagination) return ok(result.data);
  const { paginationMeta } = require("../../utils/pagination");
  return ok(result.data, { pagination: paginationMeta(pagination, result.total) });
}

async function updateAssignment(assignmentId, payload, actor) {
  const data = await surveySketchAssignmentService.update(assignmentId, payload, actor);
  return ok(data);
}

async function respondToAssignment(assignmentId, cadUser, payload) {
  const action = payload?.action || "accept";
  const data = await surveySketchAssignmentService.respondToAssignment(assignmentId, cadUser, action);
  return ok(data);
}

module.exports = {
  createAssignment,
  getAssignment,
  listByCadCenter,
  listAll,
  updateAssignment,
  respondToAssignment,
};
