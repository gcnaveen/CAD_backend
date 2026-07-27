/**
 * Upload Controller – images and audio only
 * H-10: authenticated presign; client PUT then POST /api/upload/confirm.
 */

const uploadService = require("../services/upload.service");
const { ok } = require("../utils/response");

/**
 * Get presigned URL for image upload.
 * Client: PUT file to uploadUrl, then confirm, then use fileUrl in API payloads.
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
    expiresIn: result.expiresIn,
    confirmRequired: result.confirmRequired !== false,
    confirmPath: result.confirmPath || "POST /api/upload/confirm",
    watermarkPolicy: result.watermarkPolicy,
    uploadInstructions:
      "PUT raw file bytes to signedUploadUrl. Send exactly uploadHeaders (especially Content-Type). Do not add Authorization or extra x-amz-* headers. Then POST /api/upload/confirm with key before treating the file as trusted.",
  };
}

async function getImageUploadUrl(params, currentUser, requestMeta = {}) {
  if (Array.isArray(params.files) && params.files.length > 0) {
    const result = await uploadService.getImageUploadUrls(params, currentUser, requestMeta);
    return ok({
      message:
        "Upload each file with PUT to its signedUploadUrl, confirm each key, then use each publicFileUrl in your payload.",
      files: result.files.map(mapUploadResult),
      entityId: result.entityId,
      bucket: result.bucket,
    });
  }

  const result = await uploadService.getImageUploadUrl(params, currentUser, requestMeta);
  return ok({
    message:
      "Upload with PUT to signedUploadUrl, then POST /api/upload/confirm with key, then use publicFileUrl in your payload.",
    ...mapUploadResult(result),
  });
}

/**
 * Get presigned URL for audio upload.
 */
async function getAudioUploadUrl(params, currentUser, requestMeta = {}) {
  if (Array.isArray(params.files) && params.files.length > 0) {
    const result = await uploadService.getAudioUploadUrls(params, currentUser, requestMeta);
    return ok({
      message:
        "Upload each file with PUT to its signedUploadUrl, confirm each key, then use each publicFileUrl in your payload.",
      files: result.files.map(mapUploadResult),
      entityId: result.entityId,
      bucket: result.bucket,
    });
  }

  const result = await uploadService.getAudioUploadUrl(params, currentUser, requestMeta);
  return ok({
    message:
      "Upload with PUT to signedUploadUrl, then POST /api/upload/confirm with key, then use publicFileUrl in your payload.",
    ...mapUploadResult(result),
  });
}

/**
 * Delete an uploaded file (image or audio) by key or fileUrl.
 */
async function deleteUpload(params, currentUser, requestMeta = {}) {
  const result = await uploadService.deleteUpload(params, currentUser, requestMeta);
  return ok({
    message: "File deleted from S3.",
    deleted: result.deleted,
    key: result.key,
  });
}

async function confirmUpload(params, currentUser, requestMeta = {}) {
  const result = await uploadService.confirmUpload(params, currentUser, requestMeta);
  return ok({
    message: "Upload confirmed (signature/AV gate passed).",
    ...result,
  });
}

async function getCadDeliverableUploadUrl(params, currentUser, requestMeta = {}) {
  const result = await uploadService.getCadDeliverableUploadUrl(params, currentUser, requestMeta);
  return ok({
    message:
      "CAD deliverable: PUT to signedUploadUrl, then POST /api/upload/confirm, then include key/url/role/confirmed/sha256 on deliver.",
    ...mapUploadResult(result),
    role: result.role,
    contractVersion: result.contractVersion,
  });
}

async function startCadDeliverableMultipart(params, currentUser, requestMeta = {}) {
  const result = await uploadService.startCadDeliverableMultipart(params, currentUser, requestMeta);
  return ok({
    message: "Multipart CAD deliverable started. Request part URLs, upload parts, then complete.",
    ...result,
  });
}

async function getCadDeliverablePartUrl(params, currentUser, requestMeta = {}) {
  const result = await uploadService.getCadDeliverablePartUrl(params, currentUser, requestMeta);
  return ok(result);
}

async function completeCadDeliverableMultipart(params, currentUser, requestMeta = {}) {
  const result = await uploadService.completeCadDeliverableMultipart(params, currentUser, requestMeta);
  return ok({
    message: "Multipart upload completed and security confirm ran.",
    ...result,
  });
}

async function abortCadDeliverableMultipart(params, currentUser, requestMeta = {}) {
  const result = await uploadService.abortCadDeliverableMultipart(params, currentUser, requestMeta);
  return ok(result);
}

module.exports = {
  getImageUploadUrl,
  getAudioUploadUrl,
  getCadDeliverableUploadUrl,
  startCadDeliverableMultipart,
  getCadDeliverablePartUrl,
  completeCadDeliverableMultipart,
  abortCadDeliverableMultipart,
  deleteUpload,
  confirmUpload,
};
