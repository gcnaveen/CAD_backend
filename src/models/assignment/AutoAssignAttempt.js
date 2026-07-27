/**
 * Append-only auto-assignment attempt audit (M-09).
 */

const mongoose = require("mongoose");

const AUTO_ASSIGN_ATTEMPT_OUTCOME = Object.freeze({
  SUCCESS: "SUCCESS",
  FAILURE: "FAILURE",
  SKIPPED: "SKIPPED",
});

const AutoAssignAttemptSchema = new mongoose.Schema(
  {
    surveyorSketchUpload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveyorSketchUpload",
      required: true,
      index: true,
    },
    attemptNo: { type: Number, required: true, min: 1 },
    source: {
      type: String,
      enum: ["SUBMIT", "RETRY_JOB", "MANUAL_RETRY", "MANUAL_ASSIGN"],
      required: true,
    },
    outcome: {
      type: String,
      enum: Object.values(AUTO_ASSIGN_ATTEMPT_OUTCOME),
      required: true,
      index: true,
    },
    failureCode: { type: String, default: null, index: true },
    failureReason: { type: String, default: null, maxlength: 500 },
    cadCenterId: { type: mongoose.Schema.Types.ObjectId, ref: "CadCenter", default: null },
    assignmentId: { type: mongoose.Schema.Types.ObjectId, ref: "SurveySketchAssignment", default: null },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    correlationId: { type: String, default: null },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "auto_assign_attempts", strict: true }
);

AutoAssignAttemptSchema.index({ surveyorSketchUpload: 1, createdAt: -1 });
AutoAssignAttemptSchema.index({ createdAt: -1 });

AutoAssignAttemptSchema.pre(["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany"], function () {
  throw new Error("AutoAssignAttempt is append-only");
});

const AutoAssignAttempt =
  mongoose.models.AutoAssignAttempt || mongoose.model("AutoAssignAttempt", AutoAssignAttemptSchema);

module.exports = AutoAssignAttempt;
module.exports.AUTO_ASSIGN_ATTEMPT_OUTCOME = AUTO_ASSIGN_ATTEMPT_OUTCOME;
