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
  /** Surveyor raised the request; awaiting admin assignment to a CAD center. */
  PENDING: "PENDING",
  /** Admin has assigned this sketch to a CAD center. */
  ASSIGNED: "ASSIGNED",
  UNDER_REVIEW: "UNDER_REVIEW",
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
]);

/** Max file size in bytes: 10 MB for images. */
const UPLOAD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Max file size in bytes: 25 MB for audio. */
const UPLOAD_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

/** Presigned URL expiry: 15 minutes. */
const UPLOAD_PRESIGNED_EXPIRES_SECONDS = 900;

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
  SURVEY_SKETCH_ACCEPT_TYPES,
  SURVEY_SKETCH_ACCEPT_EXTENSIONS,
  UPLOAD_MEDIA_TYPE,
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
  UPLOAD_PRESIGNED_EXPIRES_SECONDS,
};

