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
function mapUploadResult(result) {
  return {
    signedUploadUrl: result.uploadUrl,
    uploadUrl: result.uploadUrl,
    publicFileUrl: result.fileUrl,
    fileUrl: result.fileUrl,
    key: result.key,
    contentType: result.contentType,
    uploadHeaders: result.uploadHeaders,
    bucket: result.bucket,
    uploadInstructions:
      "PUT raw file bytes to signedUploadUrl. Send exactly uploadHeaders (especially Content-Type). Do not add Authorization or extra x-amz-* headers.",
  };
}

async function getImageUploadUrl(params, currentUser) {
  if (Array.isArray(params.files) && params.files.length > 0) {
    const result = await uploadService.getImageUploadUrls(params, currentUser);
    return ok({
      message:
        "Upload each file with PUT to its signedUploadUrl, then use each publicFileUrl in your payload.",
      files: result.files.map(mapUploadResult),
      entityId: result.entityId,
      bucket: result.bucket,
    });
  }

  const result = await uploadService.getImageUploadUrl(params, currentUser);
  return ok({
    message:
      "Upload with PUT to signedUploadUrl (or uploadUrl), then use publicFileUrl (or fileUrl) in your payload.",
    signedUploadUrl: result.uploadUrl,
    uploadUrl: result.uploadUrl,
    publicFileUrl: result.fileUrl,
    fileUrl: result.fileUrl,
    key: result.key,
    contentType: result.contentType,
    uploadHeaders: result.uploadHeaders,
    bucket: result.bucket,
    uploadInstructions:
      "PUT raw file bytes to signedUploadUrl. Send exactly uploadHeaders (especially Content-Type). Do not add Authorization or extra x-amz-* headers.",
  });
}

/**
 * Get presigned URL for audio upload.
 * Client: PUT file to uploadUrl, then use fileUrl in API payloads.
 */
async function getAudioUploadUrl(params, currentUser) {
  if (Array.isArray(params.files) && params.files.length > 0) {
    const result = await uploadService.getAudioUploadUrls(params, currentUser);
    return ok({
      message:
        "Upload each file with PUT to its signedUploadUrl, then use each publicFileUrl in your payload.",
      files: result.files.map(mapUploadResult),
      entityId: result.entityId,
      bucket: result.bucket,
    });
  }

  const result = await uploadService.getAudioUploadUrl(params, currentUser);
  return ok({
    message:
      "Upload with PUT to signedUploadUrl (or uploadUrl), then use publicFileUrl (or fileUrl) in your payload.",
    signedUploadUrl: result.uploadUrl,
    uploadUrl: result.uploadUrl,
    publicFileUrl: result.fileUrl,
    fileUrl: result.fileUrl,
    key: result.key,
    contentType: result.contentType,
    uploadHeaders: result.uploadHeaders,
    bucket: result.bucket,
    uploadInstructions:
      "PUT raw file bytes to signedUploadUrl. Send exactly uploadHeaders (especially Content-Type). Do not add Authorization or extra x-amz-* headers.",
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
