/**
 * Scheduled job: auto-reject CAD assignments that remain ASSIGNED for too long.
 * Triggered by CloudWatch Events / EventBridge schedule.
 */
const asyncHandler = require("../utils/asyncHandler");
const { connectDB } = require("../config/db");
const surveySketchAssignmentService = require("../services/assignment/surveySketchAssignment.service");

exports.handler = asyncHandler(async () => {
  await connectDB();
  const result = await surveySketchAssignmentService.autoRejectExpiredAssignments();
  return {
    success: true,
    ...result,
  };
});

