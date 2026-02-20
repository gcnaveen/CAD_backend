/**
 * Upload Controller – images and audio only
 * S3 presigned PUT (bucket: caddrawing). Production: strict validation, clear responses.
 */

const uploadService = require("../services/upload.service");
const { ok } = require("../utils/response");

/**
 * Get presigned URL for image upload.
 * Client: PUT file to uploadUrl, then use fileUrl in API payloads.
 */
async function getImageUploadUrl(params, currentUser) {
  const result = await uploadService.getImageUploadUrl(params, currentUser);
  return ok({
    message: "Upload the image with PUT to uploadUrl, then use fileUrl in your payload.",
    uploadUrl: result.uploadUrl,
    fileUrl: result.fileUrl,
    key: result.key,
  });
}

/**
 * Get presigned URL for audio upload.
 * Client: PUT file to uploadUrl, then use fileUrl in API payloads.
 */
async function getAudioUploadUrl(params, currentUser) {
  const result = await uploadService.getAudioUploadUrl(params, currentUser);
  return ok({
    message: "Upload the audio with PUT to uploadUrl, then use fileUrl in your payload.",
    uploadUrl: result.uploadUrl,
    fileUrl: result.fileUrl,
    key: result.key,
  });
}

/**
 * Delete an uploaded file (image or audio) by key or fileUrl.
 */
async function deleteUpload(params, currentUser) {
  const result = await uploadService.deleteUpload(params, currentUser);
  return ok({
    message: "File deleted from S3.",
    deleted: result.deleted,
    key: result.key,
  });
}

module.exports = {
  getImageUploadUrl,
  getAudioUploadUrl,
  deleteUpload,
};
