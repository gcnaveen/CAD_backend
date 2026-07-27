/**
 * Scheduled: CAD accept timeout + auto-assign retries + SLA warning/breach alerts (M-09/M-10).
 */
const asyncHandler = require("../utils/asyncHandler");
const { connectDB } = require("../config/db");
const surveySketchAssignmentService = require("../services/assignment/surveySketchAssignment.service");
const autoAssign = require("../services/autoAssign.service");
const logger = require("../utils/logger");

exports.handler = asyncHandler(async () => {
  await connectDB();
  const rejectResult = await surveySketchAssignmentService.autoRejectExpiredAssignments();
  let retryResult = { retried: 0, exceptionCount: 0 };
  let slaResult = { scanned: 0, warned: 0, escalated: 0, breached: 0 };
  try {
    retryResult = await autoAssign.processAutoAssignRetries({ limit: 40 });
  } catch (err) {
    logger.error("auto-assign retry job failed", err);
  }
  try {
    slaResult = await surveySketchAssignmentService.processSlaAlerts({ limit: 200 });
  } catch (err) {
    logger.error("SLA alert job failed", err);
  }
  return {
    success: true,
    autoReject: rejectResult,
    autoAssignRetry: retryResult,
    slaAlerts: slaResult,
  };
});
