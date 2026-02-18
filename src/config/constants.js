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
  PENDING: "PENDING",
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

module.exports = {
  USER_ROLES,
  USER_STATUS,
  MASTER_STATUS,
  HTTP_STATUS,
  CAD_AVAILABILITY,
  SURVEYOR_CATEGORY,
  SURVEYOR_TYPE,
  SURVEY_FLAT_TYPE,
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_DOCUMENT_KEYS,
  SURVEY_SKETCH_ACCEPT_TYPES,
  SURVEY_SKETCH_ACCEPT_EXTENSIONS,
};

