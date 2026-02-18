/**
 * Surveyor Sketch Upload – submission of survey info + document URLs from the surveyor dashboard.
 * Aligned with frontend: CAD/cad_frotend/src/dashboard/user (SurveyInfo + UploadSurvey forms).
 *
 * Flow: Frontend uploads files (e.g. to S3/presigned URL), then POSTs this payload with document URLs.
 */
const mongoose = require("mongoose");
const {
  SURVEY_FLAT_TYPE,
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_DOCUMENT_KEYS,
} = require("../../config/constants");

// -------- Document reference (one per survey record type) --------
const SurveyDocumentSchema = new mongoose.Schema(
  {
    /** Storage URL or key (S3 key, CDN URL, etc.). */
    url: { type: String, required: true, trim: true },
    /** Original filename for display/download. */
    fileName: { type: String, trim: true, default: null },
    /** MIME type (e.g. application/pdf, image/jpeg). */
    mimeType: { type: String, trim: true, default: null },
    /** File size in bytes (optional). */
    size: { type: Number, default: null },
    /** When the file was uploaded (server or client timestamp). */
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

// -------- Main schema --------
const SurveyorSketchUploadSchema = new mongoose.Schema(
  {
    /** Surveyor who submitted (required). */
    surveyor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // -------- Survey Info (from SurveyInfo form) --------
    surveyType: {
      type: String,
      enum: Object.values(SURVEY_FLAT_TYPE),
      required: true,
      index: true,
    },
    district: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      index: true,
    },
    taluka: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Taluka",
      required: true,
      index: true,
    },
    hobli: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hobli",
      required: true,
      index: true,
    },
    village: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Village",
      required: true,
      index: true,
    },
    surveyNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /** Auto-generated application ID: DISTRICT_CODE/TALUKA_CODE/YY/N (e.g., KA-BLR/BLR-N/26/1). */
    applicationId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },

    // -------- Documents (from UploadSurvey form) --------
    /** One entry per key: moolaTippani, hissaTippani, atlas, rrPakkabook, kharabu. */
    documents: {
      type: Map,
      of: SurveyDocumentSchema,
      default: () => new Map(),
    },

    /** Optional notes (e.g. "If joint flat, provide all survey no. details"). */
    others: {
      type: String,
      trim: true,
      default: null,
      maxlength: 2000,
    },

    /** Workflow status. */
    status: {
      type: String,
      enum: Object.values(SURVEY_SKETCH_STATUS),
      default: SURVEY_SKETCH_STATUS.PENDING,
      index: true,
    },

    /** Optional rejection/approval note from reviewer. */
    statusNote: {
      type: String,
      trim: true,
      default: null,
      maxlength: 500,
    },

    /** Set when status becomes APPROVED/REJECTED (for audit). */
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// -------- Indexes (production: list by surveyor/status, location lookup, applicationId) --------
SurveyorSketchUploadSchema.index({ surveyor: 1, createdAt: -1 });
SurveyorSketchUploadSchema.index({ surveyor: 1, status: 1, createdAt: -1 });
SurveyorSketchUploadSchema.index({ status: 1, createdAt: -1 });
SurveyorSketchUploadSchema.index({ district: 1, taluka: 1, hobli: 1, village: 1 });
SurveyorSketchUploadSchema.index({ surveyNo: 1, village: 1 });

// -------- Validation: at least one document required --------
SurveyorSketchUploadSchema.pre("validate", function (next) {
  const docKeys = Array.from(this.documents?.keys() ?? []);
  const validKeys = SURVEY_SKETCH_DOCUMENT_KEYS.filter((k) => docKeys.includes(k));
  const hasAtLeastOne = validKeys.some(
    (k) => this.documents.get(k)?.url
  );
  if (!hasAtLeastOne) {
    return next(
      new Error(
        "At least one survey document (moolaTippani, hissaTippani, atlas, rrPakkabook, kharabu) is required"
      )
    );
  }
  next();
});

// -------- Auto-generate applicationId before save --------
SurveyorSketchUploadSchema.pre("save", async function (next) {
  // Skip generation if applicationId is already set (preserve manual assignment or existing value)
  if (this.applicationId) {
    return next();
  }

  try {
    // Populate district and taluka if they're ObjectIds (not already populated)
    if (!this.district?.code || !this.taluka?.code) {
      await this.populate([
        { path: "district", select: "code" },
        { path: "taluka", select: "code" },
      ]);
    }

    const districtCode = this.district?.code || this.district;
    const talukaCode = this.taluka?.code || this.taluka;

    if (!districtCode || !talukaCode) {
      return next(new Error("District and taluka codes are required to generate applicationId"));
    }

    // Get 2-digit year (e.g., 2026 → 26)
    const year = new Date().getFullYear().toString().slice(-2);

    // Build prefix pattern: DISTRICT_CODE/TALUKA_CODE/YY/
    const prefix = `${districtCode}/${talukaCode}/${year}/`;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Single query: find the doc with highest number for this prefix (index-friendly)
    const lastDoc = await this.constructor
      .findOne({ applicationId: new RegExp(`^${escapedPrefix}\\d+$`) })
      .sort({ applicationId: -1 })
      .select("applicationId")
      .lean();

    let maxNumber = 0;
    if (lastDoc?.applicationId) {
      const match = lastDoc.applicationId.match(new RegExp(`^${escapedPrefix}(\\d+)$`));
      if (match?.[1]) maxNumber = parseInt(match[1], 10);
    }

    const nextNumber = maxNumber + 1;

    // Generate applicationId: DISTRICT_CODE/TALUKA_CODE/YY/N
    this.applicationId = `${prefix}${nextNumber}`;
    next();
  } catch (error) {
    next(error);
  }
});

// -------- Helpers --------
/** Normalize documents from flat object to Map for storage. */
function documentsFromPayload(payload) {
  const map = new Map();
  for (const key of SURVEY_SKETCH_DOCUMENT_KEYS) {
    const raw = payload[key];
    if (!raw) continue;
    const entry =
      typeof raw === "string"
        ? { url: raw.trim(), fileName: null, mimeType: null, size: null }
        : {
            url: (raw.url || raw.path || "").toString().trim(),
            fileName: raw.fileName != null ? String(raw.fileName).trim() : null,
            mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : null,
            size: raw.size != null ? Number(raw.size) : null,
            uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
          };
    if (entry.url) map.set(key, entry);
  }
  return map;
}

module.exports =
  mongoose.models.SurveyorSketchUpload ||
  mongoose.model("SurveyorSketchUpload", SurveyorSketchUploadSchema);
module.exports.SurveyDocumentSchema = SurveyDocumentSchema;
module.exports.documentsFromPayload = documentsFromPayload;
module.exports.SURVEY_SKETCH_DOCUMENT_KEYS = SURVEY_SKETCH_DOCUMENT_KEYS;
