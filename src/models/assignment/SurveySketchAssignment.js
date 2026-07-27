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
    /** CAD center (optional; legacy pool assignments). Omit when assigning directly to a CAD user. */
    cadCenter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CadCenter",
      default: null,
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
    /** When the assignment was created / SLA clock start. */
    assignedAt: {
      type: Date,
      default: () => new Date(),
      index: true,
    },
    /**
     * Server-owned delivery deadline (M-10). UTC.
     * Clients must not set this — use admin SLA extend API for changes.
     */
    dueAt: {
      type: Date,
      default: null,
      index: true,
    },
    /** @deprecated Legacy mirror of dueAt for older FE — always synced from dueAt. */
    dueDate: {
      type: Date,
      default: null,
    },
    /** Frozen SLA budget at assign time (ms). */
    slaDurationMs: {
      type: Number,
      default: null,
    },
    /** Accumulated pause duration (ON_HOLD). */
    slaPausedTotalMs: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** When non-null, clock is paused. */
    slaPausedAt: {
      type: Date,
      default: null,
    },
    /**
     * Cached SLA state for indexing/sort (recomputed on transitions + jobs).
     * ON_TRACK | WARNING | ESCALATED | BREACHED | PAUSED | MET | CANCELLED
     */
    slaState: {
      type: String,
      default: null,
      index: true,
    },
    /** Immutable SLA extensions (admin). */
    slaExtensions: {
      type: [
        {
          at: { type: Date, required: true },
          ms: { type: Number, required: true, min: 1 },
          reason: { type: String, maxlength: 500, default: null },
          by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
      ],
      default: () => [],
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
    /** Set when a CAD user rejects the assignment (including legacy pool); used for dashboard reject counts. */
    rejectedByCad: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
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
SurveySketchAssignmentSchema.index({ dueAt: 1, status: 1 });
SurveySketchAssignmentSchema.index({ slaState: 1, dueAt: 1 });

module.exports =
  mongoose.models.SurveySketchAssignment ||
  mongoose.model("SurveySketchAssignment", SurveySketchAssignmentSchema);
