/**
 * S3 utility – presigned PUT URLs for images and audio
 * Bucket: caddrawing. Folders: images | audio only.
 * Production: strict key format, no path traversal, configurable bucket/region.
 */

const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { randomUUID } = require("crypto");

const BUCKET = process.env.S3_BUCKET || "caddrawing";
const REGION = process.env.AWS_REGION || process.env.REGION || "ap-south-1";

const UPLOADS_PREFIX = "uploads";

/** Only two folder types supported. */
const UPLOAD_FOLDER_TYPES = Object.freeze(["images", "audio"]);

const s3Client = new S3Client({ region: REGION });

/**
 * Sanitize filename for S3 key: strip path, limit length, allow only safe chars.
 * @param {string} fileName
 * @param {number} maxLength
 * @returns {string}
 */
function sanitizeFileName(fileName, maxLength = 200) {
  if (!fileName || typeof fileName !== "string") return "file";
  const base = fileName.replace(/^.*[/\\]/, "").trim();
  const safe = base.replace(/[^\w.\-]/g, "_").slice(0, maxLength);
  return safe || "file";
}

/**
 * Build S3 key for uploads.
 * Pattern: uploads/{folderType}/{entityId}/{uuid}-{sanitizedFileName}
 * @param {"images"|"audio"} folderType
 * @param {string} entityId - Optional; e.g. drawingRequestId, surveyorSketchId. Use "misc" if none.
 * @param {string} fileName
 * @returns {string}
 */
function buildUploadKey(folderType, entityId, fileName) {
  const safeType = UPLOAD_FOLDER_TYPES.includes(folderType) ? folderType : "images";
  const safeId = (entityId || "misc").toString().trim().replace(/\s+/g, "") || "misc";
  const safeName = sanitizeFileName(fileName);
  const uuid = randomUUID();
  return `${UPLOADS_PREFIX}/${safeType}/${safeId}/${uuid}-${safeName}`;
}

/**
 * Get presigned PUT URL for single file upload.
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type
 * @param {number} [expiresIn] - Seconds until URL expires
 * @returns {Promise<string>}
 */
async function getPresignedPutUrl(key, contentType, expiresIn = 900) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || "application/octet-stream",
  });
  return getSignedUrl(s3Client, command, { expiresIn });
}

/**
 * Get public URL for the object (direct S3 URL).
 * For private buckets, use CloudFront or signed GET; presigned PUT still works for uploads.
 */
function getPublicUrl(key) {
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
}

/**
 * Delete object by key.
 * @param {string} key
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  await s3Client.send(command);
}

/**
 * Extract S3 key from our public URL (getPublicUrl format).
 * @param {string} fileUrl
 * @returns {string|null}
 */
function keyFromFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const url = fileUrl.trim();
  const escapedBucket = BUCKET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`https://${escapedBucket}\\.s3\\.[^/]+\\.amazonaws\\.com/(.+)`);
  const match = url.match(pattern);
  return match ? match[1] : null;
}

/**
 * Assert key is under our uploads prefix (security: no deletion of arbitrary bucket keys).
 * @param {string} key
 */
function assertUploadKey(key) {
  if (!key || typeof key !== "string" || !key.trim()) {
    throw new Error("Invalid key");
  }
  const prefix = `${UPLOADS_PREFIX}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(`Key must start with ${prefix}`);
  }
}

module.exports = {
  getPresignedPutUrl,
  getPublicUrl,
  buildUploadKey,
  deleteObject,
  keyFromFileUrl,
  assertUploadKey,
  sanitizeFileName,
  BUCKET,
  REGION,
  UPLOADS_PREFIX,
  UPLOAD_FOLDER_TYPES,
};
