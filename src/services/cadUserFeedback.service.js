const CadUserFeedback = require("../models/cad/CadUserFeedback");
const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const { USER_ROLES } = require("../config/constants");
const { NotFoundError, BadRequestError, ForbiddenError } = require("../utils/errors");

async function createFeedback({ assignmentId, surveyorId, payload }) {
  const assignment = await SurveySketchAssignment.findById(assignmentId)
    .select("_id assignedTo surveyorSketchUpload")
    .lean();
  if (!assignment) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }
  if (!assignment.assignedTo) {
    throw new BadRequestError("Assignment has no assigned CAD user", {
      code: "ASSIGNMENT_CAD_USER_MISSING",
    });
  }

  const upload = await SurveyorSketchUpload.findById(assignment.surveyorSketchUpload)
    .select("_id surveyor")
    .lean();
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  if (String(upload.surveyor) !== String(surveyorId)) {
    throw new ForbiddenError("You can submit feedback only for your own assignment");
  }

  const data = {
    assignment: assignment._id,
    surveyor: surveyorId,
    cadUser: assignment.assignedTo,
    rating: payload.rating,
    remarks: payload.remarks || null,
    audio: payload.audio || null,
  };

  const doc = await CadUserFeedback.findOneAndUpdate(
    { assignment: assignment._id, surveyor: surveyorId },
    { $set: data },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .populate("assignment", "status assignedAt completedAt")
    .populate("surveyor", "name auth")
    .populate("cadUser", "name auth")
    .lean();

  return doc;
}

async function getFeedbackByAssignment({ assignmentId, actor }) {
  const assignment = await SurveySketchAssignment.findById(assignmentId)
    .select("_id assignedTo surveyorSketchUpload")
    .lean();
  if (!assignment) {
    throw new NotFoundError("Assignment not found", { code: "ASSIGNMENT_NOT_FOUND" });
  }

  const upload = await SurveyorSketchUpload.findById(assignment.surveyorSketchUpload)
    .select("_id surveyor")
    .lean();
  if (!upload) {
    throw new NotFoundError("Survey sketch upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }

  const isAdmin = actor.role === USER_ROLES.ADMIN || actor.role === USER_ROLES.SUPER_ADMIN;
  const isOwnerSurveyor = String(upload.surveyor) === String(actor._id);
  const isAssignedCad = assignment.assignedTo && String(assignment.assignedTo) === String(actor._id);
  if (!isAdmin && !isOwnerSurveyor && !isAssignedCad) {
    throw new ForbiddenError("You are not allowed to view feedback for this assignment");
  }

  const feedback = await CadUserFeedback.findOne({ assignment: assignmentId })
    .populate("assignment", "status assignedAt completedAt")
    .populate("surveyor", "name auth")
    .populate("cadUser", "name auth")
    .lean();
  if (!feedback) {
    throw new NotFoundError("Feedback not found", { code: "CAD_FEEDBACK_NOT_FOUND" });
  }
  return feedback;
}

module.exports = {
  createFeedback,
  getFeedbackByAssignment,
};
