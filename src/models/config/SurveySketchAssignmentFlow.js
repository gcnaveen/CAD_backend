const mongoose = require("mongoose");

const FLOW_KEY = "SURVEY_SKETCH_ASSIGNMENT_FLOW";

const SurveySketchAssignmentFlowSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: FLOW_KEY,
      unique: true,
      index: true,
      immutable: true,
    },
    autoAssignEnabled: {
      type: Boolean,
      default: false,
      index: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, strict: true }
);

SurveySketchAssignmentFlowSchema.statics.flowKey = FLOW_KEY;

module.exports =
  mongoose.models.SurveySketchAssignmentFlow ||
  mongoose.model("SurveySketchAssignmentFlow", SurveySketchAssignmentFlowSchema);
