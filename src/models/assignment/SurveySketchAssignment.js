/**
 * Survey Sketch Assignment – links a surveyor sketch upload to a CAD center (and optionally a CAD user).
 * Admin assigns approved survey sketches to CAD centers for drawing work.
 * Production: indexed for list by center, by sketch, by status; unique assignment per sketch (one active).
 */

const mongoose = require("mongoose");
const { SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../../config/constants");

const SurveySketchAssignmentSchema = new mongoose.Schema(
  {
    /** Surveyor sketch upload being assigned. */
    surveyorSketchUpload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveyorSketchUpload",
      required: true,
      index: true,
    },
    /** CAD center this sketch is assigned to. */
    cadCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CadCenter",
      required: true,
      index: true,
    },
    /** Optional: specific CAD user within the center assigned to do the work. */
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    /** Assignment status. */
    status: {
      type: String,
      enum: Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS),
      default: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
      index: true,
    },
    /** Admin who created the assignment. */
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** When the assignment was created. */
    assignedAt: {
      type: Date,
      default: () => new Date(),
      index: true,
    },
    /** Optional due date for completion. */
    dueDate: {
      type: Date,
      default: null,
    },
    /** When status was set to COMPLETED (audit). */
    completedAt: {
      type: Date,
      default: null,
    },
    /** Optional notes (e.g. priority, instructions). */
    notes: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
    },
  },
  { timestamps: true, strict: true }
);

// One active assignment per surveyor sketch (allow reassign by cancelling previous)
SurveySketchAssignmentSchema.index(
  { surveyorSketchUpload: 1, status: 1 },
  { partialFilterExpression: { status: { $nin: ["CANCELLED"] } } }
);
SurveySketchAssignmentSchema.index({ cadCenter: 1, status: 1, assignedAt: -1 });
SurveySketchAssignmentSchema.index({ assignedTo: 1, status: 1 });
SurveySketchAssignmentSchema.index({ assignedAt: -1 });

module.exports =
  mongoose.models.SurveySketchAssignment ||
  mongoose.model("SurveySketchAssignment", SurveySketchAssignmentSchema);
