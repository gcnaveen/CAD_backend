const mongoose = require("mongoose");

const FeedbackAudioSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, default: null },
    mimeType: { type: String, trim: true, default: null },
    size: { type: Number, default: null },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const CadUserFeedbackSchema = new mongoose.Schema(
  {
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveySketchAssignment",
      required: true,
      index: true,
    },
    surveyor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    cadUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    remarks: {
      type: String,
      trim: true,
      default: null,
      maxlength: 2000,
    },
    audio: {
      type: FeedbackAudioSchema,
      default: null,
    },
  },
  { timestamps: true, strict: true }
);

CadUserFeedbackSchema.index({ assignment: 1, surveyor: 1 }, { unique: true });
CadUserFeedbackSchema.index({ cadUser: 1, createdAt: -1 });

module.exports =
  mongoose.models.CadUserFeedback || mongoose.model("CadUserFeedback", CadUserFeedbackSchema);
