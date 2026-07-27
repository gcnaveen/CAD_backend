const USER_ROLES = Object.freeze({
    SUPER_ADMIN: "SUPER_ADMIN",
    ADMIN: "ADMIN",
    CAD: "CAD",
    SURVEYOR: "SURVEYOR",
  });
  
  const USER_STATUS = Object.freeze({
    ACTIVE: "ACTIVE",
    DISABLED: "DISABLED",
    PENDING: "PENDING",
  });

/** Master entity status (District, Taluka, Hobli, Village, CadCenter). */
const MASTER_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
});
  
  const CAD_AVAILABILITY = Object.freeze({
    AVAILABLE: "available",
    BUSY: "busy",
    OFFLINE: "offline",
  });

/** CAD Center availability status (center-level; admin can set or derive from members). */
const CAD_CENTER_AVAILABILITY = Object.freeze({
  AVAILABLE: "AVAILABLE",
  BUSY: "BUSY",
  OFFLINE: "OFFLINE",
});

/** Survey sketch assignment status (survey sketch → CAD center). */
const SURVEY_SKETCH_ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: "ASSIGNED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  ON_HOLD: "ON_HOLD",
  CANCELLED: "CANCELLED",
});
  
  const SURVEYOR_CATEGORY = Object.freeze({
    PUBLIC: "public",
    SURVEYOR: "surveyor",
  });
  
  const SURVEYOR_TYPE = Object.freeze({
  LS: "ls",
  GS: "gs",
});

/** Survey sketch upload: flat type (from Survey Info form). */
const SURVEY_FLAT_TYPE = Object.freeze({
  JOINT_FLAT: "joint_flat",
  SINGLE_FLAT: "single_flat",
});

/** Surveyor sketch submission workflow status. */
const SURVEY_SKETCH_STATUS = Object.freeze({
  /** Awaiting PhonePe payment for new sketch submission (fee configured via env). */
  PAYMENT_PENDING: "PAYMENT_PENDING",
  /** Surveyor raised the request; awaiting admin assignment to a CAD center. */
  PENDING: "PENDING",
  /** Admin has assigned this sketch to a CAD center. */
  ASSIGNED: "ASSIGNED",
  /** CAD has uploaded the finished sketch; surveyor download requires balance entitlement (C-02). */
  CAD_DELIVERED: "CAD_DELIVERED",
  /** Surveyor asked for changes/revision on delivered sketch. */
  UNDER_REVISION: "UNDER_REVISION",
  /** Backward-compat alias; use UNDER_REVISION in new code. */
  UNDER_REVIEW: "UNDER_REVISION",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
});

/** Document keys for survey records (aligned with frontend UploadSurvey form). */
const SURVEY_SKETCH_DOCUMENT_KEYS = Object.freeze([
  "moolaTippani",
  "hissaTippani",
  "atlas",
  "rrPakkabook",
  "kharabu",
]);

/** Alias keys accepted from clients for document uploads. */
const SURVEY_SKETCH_DOCUMENT_KEY_ALIASES = Object.freeze({
  rr_pakkabook: "rrPakkabook",
  rrPakkaBook: "rrPakkabook",
  rrpakkabook: "rrPakkabook",
  kharabuttar: "kharabu",
  karabu: "kharabu",
  kharabuttar_doc: "kharabu",
});

/** Allowed MIME types / extensions for survey document uploads. */
const SURVEY_SKETCH_ACCEPT_TYPES = Object.freeze([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const SURVEY_SKETCH_ACCEPT_EXTENSIONS = Object.freeze([".pdf", ".jpg", ".jpeg", ".png", ".webp"]);

const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
});

/** Upload media type: only images and audio are supported. */
const UPLOAD_MEDIA_TYPE = Object.freeze({
  IMAGE: "image",
  AUDIO: "audio",
});

/** Allowed MIME types for image uploads (sketches, CAD drawings, documents, PDFs). */
const UPLOAD_IMAGE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  // CAD / DWG — validated via AC10xx header on POST /api/upload/confirm (H-07)
  "application/acad",
  "image/vnd.dwg",
]);

/** Allowed MIME types for audio uploads (remarks, voice notes). */
const UPLOAD_AUDIO_MIME_TYPES = Object.freeze([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/m4a",
  "audio/x-m4a",
  "audio/mp4",
  "audio/x-wav",
]);

/** Max file size in bytes: 10 MB for images. */
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Max file size in bytes: 25 MB for audio. */
const UPLOAD_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Max files per multi-upload field on survey sketch / CAD deliverable payloads. */
const SURVEY_SKETCH_MAX_UPLOAD_FILES = 20;

/** Max files per batch presigned URL request. */
const UPLOAD_BATCH_MAX_FILES = 20;

/** Presigned URL expiry: 15 minutes. */
const UPLOAD_PRESIGNED_EXPIRES_SECONDS = 900;

/** CAD wallet ledger entry — payout for completed sketch work (admin marks PAID). */
const CAD_WALLET_ENTRY_STATUS = Object.freeze({
  PENDING: "PENDING",
  PAID: "PAID",
});

const CAD_WALLET_ENTRY_KIND = Object.freeze({
  INITIAL_DELIVERY: "INITIAL_DELIVERY",
  REVISION_DELIVERY: "REVISION_DELIVERY",
});

module.exports = {
  USER_ROLES,
  USER_STATUS,
  MASTER_STATUS,
  HTTP_STATUS,
  CAD_AVAILABILITY,
  CAD_CENTER_AVAILABILITY,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
  SURVEYOR_CATEGORY,
  SURVEYOR_TYPE,
  SURVEY_FLAT_TYPE,
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_DOCUMENT_KEYS,
  SURVEY_SKETCH_DOCUMENT_KEY_ALIASES,
  SURVEY_SKETCH_ACCEPT_TYPES,
  SURVEY_SKETCH_ACCEPT_EXTENSIONS,
  UPLOAD_MEDIA_TYPE,
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
  UPLOAD_PRESIGNED_EXPIRES_SECONDS,
  SURVEY_SKETCH_MAX_UPLOAD_FILES,
  UPLOAD_BATCH_MAX_FILES,
  CAD_WALLET_ENTRY_STATUS,
  CAD_WALLET_ENTRY_KIND,
};

