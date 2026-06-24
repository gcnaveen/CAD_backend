/**
 * Surveyor Sketch Upload Controller
 * HTTP responses for create, getById, list.
 */

const surveyorSketchUploadService = require("../services/surveyorSketchUpload.service");
const { ok, created } = require("../utils/response");

async function createUpload(actor, payload) {
  const result = await surveyorSketchUploadService.create(actor, payload);
  return created(result.data, result.meta);
}

async function getUpload(actor, uploadId) {
  const result = await surveyorSketchUploadService.getById(actor, uploadId);
  return ok(result);
}

async function getUploadForCad(actor, uploadId) {
  const result = await surveyorSketchUploadService.getByIdForCad(actor, uploadId);
  return ok(result);
}

async function listUploads(actor, options) {
  const result = await surveyorSketchUploadService.list(actor, options);
  return ok(result.data, result.meta);
}

async function listSurveyorOrders(actor, options) {
  const result = await surveyorSketchUploadService.listOrdersForSurveyor(actor, options);
  return ok(result.data, {
    ...result.meta,
    counts: result.counts,
  });
}

async function retrySketchPayment(actor, uploadId) {
  const result = await surveyorSketchUploadService.reinitiateSketchPayment(actor, uploadId);
  return ok(result.data, result.meta);
}

async function clearUpload(actor, uploadId) {
  const result = await surveyorSketchUploadService.clearSketchUpload(actor, uploadId);
  return ok(result);
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
  getUploadForCad,
  listUploads,
  listSurveyorOrders,
  retrySketchPayment,
  clearUpload,
  listAllWithAssignment,
};
