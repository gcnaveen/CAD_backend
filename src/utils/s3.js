/**
 * S3 utility – presigned PUT URLs for images and audio
 * Folders: uploads/images | uploads/audio only.
 *
 * Browser uploads need:
 * 1) Bucket CORS: allow PUT from your origin; AllowedHeaders must include content-type
 *    (see s3-cors.example.json / scripts/apply-s3-cors.js).
 * 2) PUT must include header Content-Type exactly equal to the contentType you sent to POST /api/upload/image|audio
 *    (same string after normalization, e.g. audio/webm). Omitting it or using blob default mismatch → 403.
 * 3) Lambda IAM + env S3_BUCKET must target the same bucket (see serverless custom.s3BucketName).
 * 4) SDK default request checksums (WHEN_SUPPORTED) add x-amz-checksum-* to presigned URLs; browsers cannot send those → 403.
 *    This client uses WHEN_REQUIRED; serverless sets AWS_REQUEST_CHECKSUM_CALCULATION=WHEN_REQUIRED on Lambda too.
 * 5) Do not sign x-amz-server-side-encryption on browser PUTs (FE sends Content-Type only).
 *    Rely on bucket default SSE-S3 for H-07. If a bucket policy requires the SSE header, either
 *    relax that condition or teach the FE to send uploadHeaders including that header.
 */

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { randomUUID } = require("crypto");

/** H-06: no hardcoded bucket fallback — S3_BUCKET must be configured. */
function getBucket() {
  const b = String(process.env.S3_BUCKET || "").trim();
  if (!b) {
    throw new Error(
      "S3_BUCKET is not configured. Set it in .env / Lambda environment (audit H-06 — no hardcoded bucket defaults)."
    );
  }
  return b;
}

const REGION = process.env.AWS_REGION || process.env.REGION || "ap-south-1";

const UPLOADS_PREFIX = "uploads";
const QUARANTINE_PREFIX = "quarantine";

/** Only folder types supported under uploads/. */
const UPLOAD_FOLDER_TYPES = Object.freeze(["images", "audio", "cad-deliverables"]);

/**
 * Presigned PUT must NOT use WHEN_SUPPORTED request checksums: the SDK would add
 * x-amz-checksum-* to the signed URL; browsers cannot send those → 403.
 * WHEN_REQUIRED skips checksum for PutObject (not required) so only host (+ hoisted content-type) is signed.
 *
 * Optional S3_PRESIGN_ACCESS_KEY_ID / S3_PRESIGN_SECRET_ACCESS_KEY (/ S3_PRESIGN_SESSION_TOKEN):
 * used only to sign browser upload URLs when the Lambda execution role cannot PutObject on
 * S3_BUCKET (e.g. role still points at legacy ccaddrawing). Prefer fixing the role IAM instead.
 */
function buildS3Client(credentials) {
  const opts = {
    region: REGION,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };
  if (credentials) opts.credentials = credentials;
  return new S3Client(opts);
}

function getPresignCredentialsFromEnv() {
  const accessKeyId = String(process.env.S3_PRESIGN_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.S3_PRESIGN_SECRET_ACCESS_KEY || "").trim();
  if (!accessKeyId || !secretAccessKey) return null;
  const sessionToken = String(process.env.S3_PRESIGN_SESSION_TOKEN || "").trim();
  return {
    accessKeyId,
    secretAccessKey,
    ...(sessionToken ? { sessionToken } : {}),
  };
}

const s3Client = buildS3Client(null);

/** Client used for browser presigned PUT/GET (may use dedicated upload credentials). */
function getPresignS3Client() {
  const creds = getPresignCredentialsFromEnv();
  if (!creds) return s3Client;
  return buildS3Client(creds);
}

/** Client for server-side S3 ops (delete/copy/head) — always the Lambda role. */
function getServerS3Client() {
  return s3Client;
}

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
 * Build S3 key for uploads bound to a user (H-10).
 * Pattern: uploads/{folderType}/user/{userId}/{entityId}/{uuid}-{sanitizedFileName}
 */
function buildUploadKey(folderType, entityId, fileName, userId = null) {
  const safeType = UPLOAD_FOLDER_TYPES.includes(folderType) ? folderType : "images";
  const safeId = (entityId || "misc").toString().trim().replace(/\s+/g, "") || "misc";
  const safeName = sanitizeFileName(fileName);
  const uuid = randomUUID();
  const uid = userId != null ? String(userId).replace(/[^\w.\-]/g, "").slice(0, 64) : "anonymous";
  return `${UPLOADS_PREFIX}/${safeType}/user/${uid}/${safeId}/${uuid}-${safeName}`;
}

/**
 * Get presigned PUT URL for single file upload.
 * @param {string} key - S3 object key
 * @param {string} contentType - MIME type
 * @param {number} [expiresIn] - Seconds until URL expires
 * @returns {Promise<string>}
 */
async function getPresignedPutUrl(key, contentType, expiresIn = 900) {
  const ct = contentType || "application/octet-stream";
  // Do not sign ServerSideEncryption. Signing it forces the browser to send
  // x-amz-server-side-encryption; current FE only sends Content-Type → 403.
  // H-07: use bucket default encryption (AES256) instead of a signed SSE header.
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: ct,
  });
  return getSignedUrl(getPresignS3Client(), command, {
    expiresIn,
    signableHeaders: new Set(["content-type"]),
  });
}

/** Headers the browser must send on PUT (must match signed values). */
function getPresignedPutUploadHeaders(contentType) {
  return {
    "Content-Type": contentType || "application/octet-stream",
  };
}

/**
 * Short-lived presigned GET for private deliverable download (audit C-02).
 * @param {string} key
 * @param {number} [expiresIn] - Seconds (default 120)
 * @returns {Promise<string>}
 */
async function getPresignedGetUrl(key, expiresIn = 120) {
  assertUploadKey(key);
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getPresignS3Client(), command, { expiresIn });
}

/**
 * Get public URL for the object (direct S3 URL).
 * For private buckets, use CloudFront or signed GET; presigned PUT still works for uploads.
 */
function getPublicUrl(key) {
  return `https://${getBucket()}.s3.${REGION}.amazonaws.com/${key}`;
}

/**
 * Delete object by key.
 * @param {string} key
 */
async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  await s3Client.send(command);
}

/**
 * Read first N bytes of an object (magic-byte / DWG checks).
 * @param {string} key
 * @param {number} [byteCount=64]
 * @returns {Promise<Buffer>}
 */
async function getObjectPrefixBytes(key, byteCount = 64) {
  assertUploadKey(key);
  const end = Math.max(0, Number(byteCount) - 1);
  const out = await s3Client.send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Range: `bytes=0-${end}`,
    })
  );
  const chunks = [];
  for await (const chunk of out.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Head object for size / etag metadata (H-12 checksum package). */
async function headObject(key) {
  assertUploadKey(key);
  const out = await s3Client.send(
    new HeadObjectCommand({
      Bucket: getBucket(),
      Key: key,
    })
  );
  return {
    contentLength: out.ContentLength != null ? Number(out.ContentLength) : null,
    contentType: out.ContentType || null,
    eTag: out.ETag ? String(out.ETag).replace(/"/g, "") : null,
    serverSideEncryption: out.ServerSideEncryption || null,
  };
}

/**
 * Start multipart upload for large CAD sources (H-12).
 */
async function createMultipartUpload(key, contentType) {
  assertUploadKey(key);
  const out = await s3Client.send(
    new CreateMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      ContentType: contentType || "application/octet-stream",
      ServerSideEncryption: "AES256",
    })
  );
  return { uploadId: out.UploadId, key, bucket: getBucket() };
}

async function getPresignedUploadPartUrl(key, uploadId, partNumber, expiresIn = 900) {
  assertUploadKey(key);
  const command = new UploadPartCommand({
    Bucket: getBucket(),
    Key: key,
    UploadId: uploadId,
    PartNumber: partNumber,
  });
  const url = await getSignedUrl(getPresignS3Client(), command, { expiresIn });
  return url;
}

async function completeMultipartUpload(key, uploadId, parts) {
  assertUploadKey(key);
  await s3Client.send(
    new CompleteMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: (parts || []).map((p) => {
          let etag = String(p.eTag || p.ETag || "").trim();
          if (etag && !etag.startsWith('"')) etag = `"${etag.replace(/"/g, "")}"`;
          return {
            ETag: etag,
            PartNumber: Number(p.partNumber || p.PartNumber),
          };
        }),
      },
    })
  );
  return { key, fileUrl: getPublicUrl(key) };
}

async function abortMultipartUpload(key, uploadId) {
  assertUploadKey(key);
  await s3Client.send(
    new AbortMultipartUploadCommand({
      Bucket: getBucket(),
      Key: key,
      UploadId: uploadId,
    })
  );
  return { aborted: true, key };
}

/**
 * Move object to quarantine/ prefix (H-07 malware / bad signature).
 * @returns {Promise<string>} quarantine key
 */
async function quarantineObject(key, reason = "quarantine") {
  assertUploadKey(key);
  const safeReason = String(reason || "quarantine")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 40);
  const destKey = `${QUARANTINE_PREFIX}/${Date.now()}-${safeReason}-${key.replace(/^uploads\//, "")}`;
  const bucket = getBucket();
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${key}`,
      Key: destKey,
      ServerSideEncryption: "AES256",
      MetadataDirective: "REPLACE",
      Metadata: { quarantined: "true", reason: safeReason },
    })
  );
  await deleteObject(key);
  return destKey;
}

/**
 * Extract S3 key from our public URL (getPublicUrl format).
 * @param {string} fileUrl
 * @returns {string|null}
 */
function keyFromFileUrl(fileUrl) {
  if (!fileUrl || typeof fileUrl !== "string") return null;
  const url = fileUrl.trim();
  const escapedBucket = getBucket().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  getPresignedPutUploadHeaders,
  getPresignedGetUrl,
  getPublicUrl,
  buildUploadKey,
  deleteObject,
  getObjectPrefixBytes,
  headObject,
  createMultipartUpload,
  getPresignedUploadPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
  quarantineObject,
  keyFromFileUrl,
  assertUploadKey,
  sanitizeFileName,
  getBucket,
  /** @deprecated use getBucket() */
  get BUCKET() {
    return getBucket();
  },
  REGION,
  UPLOADS_PREFIX,
  QUARANTINE_PREFIX,
  UPLOAD_FOLDER_TYPES,
};
