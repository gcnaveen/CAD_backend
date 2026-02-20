/**
 * Upload service – images and audio only
 * Bucket: caddrawing. Strict validation: MIME type, file size, auth.
 * Production: single presigned PUT; optional entityId for grouping.
 */

const {
  getPresignedPutUrl,
  getPublicUrl,
  buildUploadKey,
  deleteObject,
  keyFromFileUrl,
  assertUploadKey,
} = require("../utils/s3");
const { BadRequestError, ForbiddenError } = require("../utils/errors");
const { USER_ROLES } = require("../config/constants");
const {
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
  UPLOAD_PRESIGNED_EXPIRES_SECONDS,
} = require("../config/constants");
const logger = require("../utils/logger");

const ALLOWED_ROLES = [USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

function assertAuthenticated(user) {
  if (!user) {
    throw new BadRequestError("Authentication required");
  }
}

function assertCanUpload(user) {
  assertAuthenticated(user);
  if (!ALLOWED_ROLES.includes(user.role)) {
    throw new ForbiddenError("You do not have permission to upload files");
  }
}

function normalizeContentType(contentType) {
  return (contentType || "").trim().toLowerCase();
}

/**
 * Validate image upload params. Returns normalized contentType.
 * @throws {BadRequestError}
 */
function validateImageUpload(params) {
  const { fileName, contentType, fileSizeBytes } = params;

  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    throw new BadRequestError("fileName is required", {
      errors: [{ field: "fileName", message: "Required" }],
    });
  }

  const ct = normalizeContentType(contentType);
  if (!ct) {
    throw new BadRequestError("contentType is required", {
      errors: [{ field: "contentType", message: "Required" }],
    });
  }
  if (!UPLOAD_IMAGE_MIME_TYPES.includes(ct)) {
    throw new BadRequestError(
      `contentType must be one of: ${UPLOAD_IMAGE_MIME_TYPES.join(", ")}`,
      { errors: [{ field: "contentType", message: "Invalid image type" }] }
    );
  }

  if (fileSizeBytes != null) {
    const size = Number(fileSizeBytes);
    if (!Number.isFinite(size) || size < 0 || size > UPLOAD_IMAGE_MAX_BYTES) {
      throw new BadRequestError(
        `fileSizeBytes must be between 0 and ${UPLOAD_IMAGE_MAX_BYTES} (${UPLOAD_IMAGE_MAX_BYTES / 1024 / 1024} MB)`,
        { errors: [{ field: "fileSizeBytes", message: "Exceeds max size" }] }
      );
    }
  }

  return ct;
}

/**
 * Validate audio upload params. Returns normalized contentType.
 * @throws {BadRequestError}
 */
function validateAudioUpload(params) {
  const { fileName, contentType, fileSizeBytes } = params;

  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    throw new BadRequestError("fileName is required", {
      errors: [{ field: "fileName", message: "Required" }],
    });
  }

  const ct = normalizeContentType(contentType);
  if (!ct) {
    throw new BadRequestError("contentType is required", {
      errors: [{ field: "contentType", message: "Required" }],
    });
  }
  if (!UPLOAD_AUDIO_MIME_TYPES.includes(ct)) {
    throw new BadRequestError(
      `contentType must be one of: ${UPLOAD_AUDIO_MIME_TYPES.join(", ")}`,
      { errors: [{ field: "contentType", message: "Invalid audio type" }] }
    );
  }

  if (fileSizeBytes != null) {
    const size = Number(fileSizeBytes);
    if (!Number.isFinite(size) || size < 0 || size > UPLOAD_AUDIO_MAX_BYTES) {
      throw new BadRequestError(
        `fileSizeBytes must be between 0 and ${UPLOAD_AUDIO_MAX_BYTES} (${UPLOAD_AUDIO_MAX_BYTES / 1024 / 1024} MB)`,
        { errors: [{ field: "fileSizeBytes", message: "Exceeds max size" }] }
      );
    }
  }

  return ct;
}

/**
 * Get presigned URL for image upload.
 * Optional entityId (e.g. drawingRequestId) for grouping in S3.
 * @param {Object} params - { fileName, contentType, entityId?, fileSizeBytes?, expiresIn? }
 * @param {Object} user - Authenticated user
 * @returns {Promise<{ uploadUrl: string, fileUrl: string, key: string }>}
 */
async function getImageUploadUrl(params, user) {
  assertCanUpload(user);

  const entityId = (params.entityId || "misc").toString().trim() || "misc";
  const contentType = validateImageUpload(params);

  const key = buildUploadKey("images", entityId, params.fileName);
  const expiresIn = Math.min(
    Math.max(parseInt(params.expiresIn, 10) || UPLOAD_PRESIGNED_EXPIRES_SECONDS, 60),
    3600
  );

  const uploadUrl = await getPresignedPutUrl(key, contentType, expiresIn);
  const fileUrl = getPublicUrl(key);

  logger.info("Image upload URL issued", {
    key,
    entityId,
    contentType,
    userId: user._id || user.id,
  });

  return { uploadUrl, fileUrl, key };
}

/**
 * Get presigned URL for audio upload.
 * Optional entityId for grouping.
 * @param {Object} params - { fileName, contentType, entityId?, fileSizeBytes?, expiresIn? }
 * @param {Object} user - Authenticated user
 * @returns {Promise<{ uploadUrl: string, fileUrl: string, key: string }>}
 */
async function getAudioUploadUrl(params, user) {
  assertCanUpload(user);

  const entityId = (params.entityId || "misc").toString().trim() || "misc";
  const contentType = validateAudioUpload(params);

  const key = buildUploadKey("audio", entityId, params.fileName);
  const expiresIn = Math.min(
    Math.max(parseInt(params.expiresIn, 10) || UPLOAD_PRESIGNED_EXPIRES_SECONDS, 60),
    3600
  );

  const uploadUrl = await getPresignedPutUrl(key, contentType, expiresIn);
  const fileUrl = getPublicUrl(key);

  logger.info("Audio upload URL issued", {
    key,
    entityId,
    contentType,
    userId: user._id || user.id,
  });

  return { uploadUrl, fileUrl, key };
}

/**
 * Delete a file from S3. Caller must have upload permission.
 * Only keys under uploads/ are allowed (security).
 * @param {Object} params - { key? | fileUrl? }
 * @param {Object} user - Authenticated user
 * @returns {Promise<{ deleted: boolean, key: string }>}
 */
async function deleteUpload(params, user) {
  assertCanUpload(user);

  let key = null;
  if (params.key && typeof params.key === "string" && params.key.trim()) {
    key = params.key.trim();
  } else if (params.fileUrl && typeof params.fileUrl === "string" && params.fileUrl.trim()) {
    key = keyFromFileUrl(params.fileUrl);
    if (!key) {
      throw new BadRequestError("fileUrl is not a valid upload URL from this bucket", {
        errors: [{ field: "fileUrl", message: "Invalid URL" }],
      });
    }
  } else {
    throw new BadRequestError("Either key or fileUrl is required", {
      errors: [{ field: "key", message: "Required if fileUrl not provided" }],
    });
  }

  assertUploadKey(key);
  await deleteObject(key);

  logger.info("Upload deleted from S3", {
    key,
    userId: user._id || user.id,
  });

  return { deleted: true, key };
}

module.exports = {
  getImageUploadUrl,
  getAudioUploadUrl,
  deleteUpload,
  validateImageUpload,
  validateAudioUpload,
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
};
