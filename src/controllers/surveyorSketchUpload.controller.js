/**
 * Surveyor Sketch Upload Controller
 * HTTP responses for create, getById, list.
 */

const surveyorSketchUploadService = require("../services/surveyorSketchUpload.service");
const { ok, created } = require("../utils/response");

async function createUpload(actor, payload) {
  const result = await surveyorSketchUploadService.create(actor, payload);
  return created(result);
}

async function getUpload(actor, uploadId) {
  const result = await surveyorSketchUploadService.getById(actor, uploadId);
  return ok(result);
}

async function listUploads(actor, options) {
  const result = await surveyorSketchUploadService.list(actor, options);
  return ok(result.data, result.meta);
}

async function listAllWithAssignment(options) {
  const result = await surveyorSketchUploadService.listAllWithAssignment(options);
  const { paginationMeta } = require("../../utils/pagination");
  const { page, limit, total } = result.meta;
  return ok(result.data, { pagination: paginationMeta({ page, limit }, total) });
}

module.exports = {
  createUpload,
  getUpload,
  listUploads,
  listAllWithAssignment,
};
