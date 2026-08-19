/**
 * N3 / GUARD-01: fail closed when a workflow record cannot be loaded.
 * Missing upload/assignment must throw — never skip payment or status gates.
 */

const { NotFoundError } = require("../utils/errors");

function requireLoadedUpload(upload) {
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", {
      code: "SURVEY_SKETCH_NOT_FOUND",
    });
  }
  return upload;
}

function requireLoadedAssignment(assignment) {
  if (!assignment) {
    throw new NotFoundError("Assignment not found", {
      code: "ASSIGNMENT_NOT_FOUND",
    });
  }
  return assignment;
}

module.exports = {
  requireLoadedUpload,
  requireLoadedAssignment,
};
