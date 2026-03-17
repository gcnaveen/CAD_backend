const mongoose = require("mongoose");
const { SURVEY_FLAT_TYPE } = require("../../config/constants");

const SurveyDocumentSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    fileName: { type: String, trim: true, default: null },
    mimeType: { type: String, trim: true, default: null },
    size: { type: Number, default: null },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const SurveyDraftSchema = new mongoose.Schema(
  {
    surveyor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    surveyType: {
      type: String,
      enum: Object.values(SURVEY_FLAT_TYPE),
      default: null,
      index: true,
    },
    district: { type: mongoose.Schema.Types.ObjectId, ref: "District", default: null, index: true },
    taluka: { type: mongoose.Schema.Types.ObjectId, ref: "Taluka", default: null, index: true },
    hobli: { type: mongoose.Schema.Types.ObjectId, ref: "Hobli", default: null, index: true },
    village: { type: mongoose.Schema.Types.ObjectId, ref: "Village", default: null, index: true },
    surveyNo: { type: String, trim: true, default: null, index: true },

    documents: {
      type: Map,
      of: SurveyDocumentSchema,
      default: () => new Map(),
    },
    singleUpload: {
      type: SurveyDocumentSchema,
      default: null,
    },

    is_originaltippani: { type: Boolean, default: false },
    is_hissatippani: { type: Boolean, default: false },
    is_atlas: { type: Boolean, default: false },
    is_rrpakkabook: { type: Boolean, default: false },
    is_akarabandu: { type: Boolean, default: false },
    is_kharabuttar: { type: Boolean, default: false },
    is_mulapatra: { type: Boolean, default: false },

    audio: { type: SurveyDocumentSchema, default: null },
    other_documents: { type: [SurveyDocumentSchema], default: () => [] },
    others: { type: String, trim: true, default: null, maxlength: 2000 },

    deletedAt: { type: Date, default: null, index: true },
  },
  {
    timestamps: true,
    strict: true,
  }
);

SurveyDraftSchema.index({ surveyor: 1, deletedAt: 1, updatedAt: -1 });
SurveyDraftSchema.index({ deletedAt: 1, updatedAt: -1 });

module.exports = mongoose.models.SurveyDraft || mongoose.model("SurveyDraft", SurveyDraftSchema);
