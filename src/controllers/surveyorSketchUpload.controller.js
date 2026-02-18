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

module.exports = {
  createUpload,
  getUpload,
  listUploads,
};
