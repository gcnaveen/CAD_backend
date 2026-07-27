/**
 * Upload service – images and audio only
 * Bucket: process.env.S3_BUCKET. Strict validation: MIME type, file size, auth.
 * Production: single presigned PUT; optional entityId for grouping.
 */

const {
  getPresignedPutUrl,
  getPresignedPutUploadHeaders,
  getPublicUrl,
  buildUploadKey,
  deleteObject,
  keyFromFileUrl,
  assertUploadKey,
  getBucket,
  getObjectPrefixBytes,
  headObject,
  quarantineObject,
  createMultipartUpload,
  getPresignedUploadPartUrl,
  completeMultipartUpload,
  abortMultipartUpload,
} = require("../utils/s3");
const mongoose = require("mongoose");
const crypto = require("crypto");
const { BadRequestError, ForbiddenError, UnauthorizedError } = require("../utils/errors");
const { USER_ROLES } = require("../config/constants");
const {
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
  UPLOAD_PRESIGNED_EXPIRES_SECONDS,
} = require("../config/constants");
const logger = require("../utils/logger");
const fileSecurity = require("./fileSecurity.service");
const { logFileAccess, FileAccessEvent } = require("./fileAccessLog.service");
const { assertUploadPresignAllowed } = require("./authThrottle.service");
const cadDeliverableContract = require("./cadDeliverableContract.service");
const { CAD_DELIVERABLE_CONTRACT_VERSION } = require("../config/cadDeliverableContract");

const ALLOWED_ROLES = [USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN];

const IMAGE_EXTENSIONS = Object.freeze([".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".dwg"]);
const AUDIO_EXTENSIONS = Object.freeze([".mp3", ".mpeg", ".wav", ".webm", ".ogg", ".m4a", ".mp4"]);

function wrapS3Error(err, context) {
  const name = err?.name || "";
  const msg = err?.message || String(err);
  logger.error("S3 operation failed", err, { ...context, bucket: getBucket() });
  if (
    name === "AccessDenied" ||
    /Access Denied|not authorized|AccessDenied/i.test(msg) ||
    name === "InvalidAccessKeyId"
  ) {
    return new BadRequestError(
      "S3 access denied. Redeploy so Lambda IAM and S3_BUCKET use the same bucket (see serverless custom.s3BucketName), and confirm the bucket exists in this AWS account/region.",
      { code: "S3_ACCESS_DENIED" }
    );
  }
  return new BadRequestError(`S3 error: ${msg}`, { code: "S3_ERROR" });
}

/** H-10: authenticated active user required (401). */
function assertCanUpload(user) {
  if (!user) {
    throw new UnauthorizedError("Authentication required", { code: "UPLOAD_AUTH_REQUIRED" });
  }
  if (!ALLOWED_ROLES.includes(user.role)) {
    throw new ForbiddenError("You do not have permission to upload files", { code: "UPLOAD_FORBIDDEN" });
  }
}

function fileExtension(fileName) {
  const n = String(fileName || "").toLowerCase();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i) : "";
}

function assertExtensionAllowed(fileName, kind) {
  const ext = fileExtension(fileName);
  const list = kind === "audio" ? AUDIO_EXTENSIONS : IMAGE_EXTENSIONS;
  if (!list.includes(ext)) {
    throw new BadRequestError(`file extension must be one of: ${list.join(", ")}`, {
      code: "UPLOAD_EXTENSION_DENIED",
      errors: [{ field: "fileName", message: "Extension not allowed" }],
    });
  }
  return ext;
}

/** H-10: size always required for presign. */
function requireDeclaredSize(fileSizeBytes, maxBytes, field = "fileSizeBytes") {
  if (fileSizeBytes == null || fileSizeBytes === "") {
    throw new BadRequestError(`${field} is required`, {
      code: "UPLOAD_SIZE_REQUIRED",
      errors: [{ field, message: "Required" }],
    });
  }
  const size = Number(fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
    throw new BadRequestError(
      `${field} must be between 1 and ${maxBytes} (${maxBytes / 1024 / 1024} MB)`,
      { code: "UPLOAD_SIZE_INVALID", errors: [{ field, message: "Invalid or exceeds max size" }] }
    );
  }
  return size;
}

function assertKeyOwnedByUser(key, user) {
  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN) return;
  const uid = String(user._id || user.id);
  const marker = `/user/${uid}/`;
  if (!String(key).includes(marker)) {
    throw new ForbiddenError("You can only access your own upload objects", {
      code: "NOT_YOUR_OBJECT",
    });
  }
}

/**
 * Bind entityId to caller: misc, opaque scoped id, or owned/assigned order ObjectId.
 *
 * Pre-order / draft flows often send a client ObjectId before SurveyorSketchUpload exists.
 * Unknown ObjectIds are allowed as opaque folder names under uploads/.../user/{userId}/…
 * (ownership is enforced by the userId key segment). Existing orders still require ownership.
 */
function opaqueEntityId(raw) {
  return String(raw).replace(/[^\w.\-]/g, "_").slice(0, 64) || "misc";
}

async function resolveBoundEntityId(user, entityId) {
  const raw = (entityId != null ? String(entityId) : "misc").trim() || "misc";
  if (raw === "misc") return "misc";

  if (!mongoose.isValidObjectId(raw)) {
    return opaqueEntityId(raw);
  }

  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPER_ADMIN) {
    return String(raw);
  }

  const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
  const upload = await SurveyorSketchUpload.findById(raw).select("surveyor").lean();

  // No order yet (new sketch / draft / client-generated id) — keep user-scoped opaque binding.
  if (!upload) {
    return opaqueEntityId(raw);
  }

  if (user.role === USER_ROLES.SURVEYOR) {
    if (String(upload.surveyor) !== String(user._id)) {
      throw new ForbiddenError("You can only upload for your own orders", { code: "NOT_YOUR_ORDER" });
    }
    return String(raw);
  }

  if (user.role === USER_ROLES.CAD) {
    const SurveySketchAssignment = require("../models/assignment/SurveySketchAssignment");
    const assignment = await SurveySketchAssignment.findOne({
      surveyorSketchUpload: raw,
      assignedTo: user._id,
      status: { $nin: ["CANCELLED"] },
    })
      .select("_id")
      .lean();
    if (!assignment) {
      throw new ForbiddenError("You can only upload for assignments you own", {
        code: "NOT_YOUR_ASSIGNMENT",
      });
    }
    return String(raw);
  }

  throw new ForbiddenError("You do not have permission to upload for this order", {
    code: "UPLOAD_ORDER_FORBIDDEN",
  });
}

async function assertDailyQuota(userId, addBytes) {
  const maxFiles = Number(process.env.UPLOAD_DAILY_FILE_QUOTA || 100);
  const maxBytes = Number(process.env.UPLOAD_DAILY_BYTE_QUOTA || 500 * 1024 * 1024);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await FileAccessEvent.find({
    actorUserId: userId,
    action: "PRESIGN_PUT",
    success: true,
    createdAt: { $gte: since },
  })
    .select("meta")
    .lean();

  const fileCount = rows.length;
  const byteSum = rows.reduce((s, r) => s + (Number(r?.meta?.fileSizeBytes) || 0), 0);
  if (fileCount >= maxFiles) {
    throw new ForbiddenError("Daily upload file quota exceeded", { code: "UPLOAD_QUOTA_FILES" });
  }
  if (byteSum + Number(addBytes || 0) > maxBytes) {
    throw new ForbiddenError("Daily upload byte quota exceeded", { code: "UPLOAD_QUOTA_BYTES" });
  }
}

function clampPresignExpiry(expiresIn) {
  const maxExp = Number(process.env.UPLOAD_PRESIGN_MAX_EXPIRES_SECONDS || 900);
  return Math.min(
    Math.max(parseInt(expiresIn, 10) || UPLOAD_PRESIGNED_EXPIRES_SECONDS, 60),
    Math.min(3600, maxExp)
  );
}


function normalizeContentType(contentType) {
  // Strip MIME parameters so MediaRecorder types like
  // "audio/webm;codecs=opus" match allow-lists and S3 signed Content-Type.
  const raw = String(contentType || "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  return raw.split(";")[0].trim();
}

/** Browser voice notes often report video/webm or codec aliases. */
function canonicalizeAudioContentType(contentType) {
  const base = normalizeContentType(contentType);
  const map = {
    "video/webm": "audio/webm",
    "audio/mp3": "audio/mpeg",
    "audio/x-mp3": "audio/mpeg",
    "audio/wave": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/aac": "audio/mp4",
    "audio/m4a": "audio/mp4",
    "audio/x-m4a": "audio/mp4",
  };
  return map[base] || base;
}

/**
 * MediaRecorder blobs are often named "blob" / "recording" with no extension.
 * Infer a safe extension from contentType so H-10 extension checks still pass.
 */
function ensureAudioFileName(fileName, contentType) {
  const raw = String(fileName || "recording").trim() || "recording";
  const ext = fileExtension(raw);
  if (ext) {
    assertExtensionAllowed(raw, "audio");
    return raw;
  }
  const ct = canonicalizeAudioContentType(contentType);
  const byCt = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
  };
  const inferred = byCt[ct] || ".webm";
  const base = raw.replace(/[^\w.\-]+/g, "_").replace(/_+$/g, "") || "recording";
  return `${base}${inferred}`;
}

/** When the browser sends application/octet-stream, infer from file extension (common for PDF). */
function inferContentType(fileName, contentType) {
  const ct = normalizeContentType(contentType);
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = String(fileName || "")
    .toLowerCase()
    .split(".")
    .pop();
  const byExt = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
  };
  return byExt[ext] || ct || "application/octet-stream";
}

function inferAudioContentType(fileName, contentType) {
  const ct = canonicalizeAudioContentType(contentType);
  if (ct && ct !== "application/octet-stream") return ct;
  const ext = String(fileName || "")
    .toLowerCase()
    .split(".")
    .pop();
  const byExt = {
    mp3: "audio/mpeg",
    mpeg: "audio/mpeg",
    wav: "audio/wav",
    webm: "audio/webm",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "audio/mp4",
  };
  return byExt[ext] || ct || "application/octet-stream";
}

/**
 * Validate image upload params. Returns { contentType, fileSizeBytes }.
 * @throws {BadRequestError}
 */
function validateImageUpload(params) {
  const { fileName, contentType, fileSizeBytes } = params;

  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    throw new BadRequestError("fileName is required", {
      errors: [{ field: "fileName", message: "Required" }],
    });
  }

  assertExtensionAllowed(fileName, "image");

  const ct = inferContentType(fileName, contentType);
  if (!ct) {
    throw new BadRequestError("contentType is required", {
      errors: [{ field: "contentType", message: "Required" }],
    });
  }
  const normalizedName = String(fileName || "").toLowerCase();
  const isDwg =
    normalizedName.endsWith(".dwg") || ct.includes("dwg") || ct.includes("acad");
  if (isDwg) {
    if (
      ct !== "application/acad" &&
      ct !== "image/vnd.dwg" &&
      ct !== "application/octet-stream" &&
      !UPLOAD_IMAGE_MIME_TYPES.includes(ct)
    ) {
      throw new BadRequestError("Invalid DWG contentType", {
        errors: [{ field: "contentType", message: "Use application/acad or .dwg filename" }],
      });
    }
    const size = requireDeclaredSize(fileSizeBytes, UPLOAD_IMAGE_MAX_BYTES);
    return {
      contentType: ct === "application/octet-stream" ? "application/acad" : ct,
      fileSizeBytes: size,
    };
  }
  if (!UPLOAD_IMAGE_MIME_TYPES.includes(ct)) {
    throw new BadRequestError(
      `contentType must be one of: ${UPLOAD_IMAGE_MIME_TYPES.join(", ")}`,
      { errors: [{ field: "contentType", message: "Invalid image type" }] }
    );
  }

  const size = requireDeclaredSize(fileSizeBytes, UPLOAD_IMAGE_MAX_BYTES);
  return { contentType: ct, fileSizeBytes: size };
}

/**
 * Validate audio upload params. Returns { contentType, fileSizeBytes, fileName }.
 */
function validateAudioUpload(params) {
  const safeName = ensureAudioFileName(params.fileName, params.contentType);

  const ct = inferAudioContentType(safeName, params.contentType);
  if (!ct || ct === "application/octet-stream") {
    throw new BadRequestError("contentType is required for audio uploads", {
      errors: [{ field: "contentType", message: "Required (e.g. audio/webm)" }],
    });
  }
  if (!UPLOAD_AUDIO_MIME_TYPES.includes(ct)) {
    throw new BadRequestError(
      `contentType must be one of: ${UPLOAD_AUDIO_MIME_TYPES.join(", ")} (got ${ct})`,
      { errors: [{ field: "contentType", message: "Invalid audio type" }] }
    );
  }

  const size = requireDeclaredSize(params.fileSizeBytes, UPLOAD_AUDIO_MAX_BYTES);
  return { contentType: ct, fileSizeBytes: size, fileName: safeName };
}

/** H-10 authenticated, user-bound image presign. */
async function getImageUploadUrl(params, user, requestMeta = {}) {
  assertCanUpload(user);
  await assertUploadPresignAllowed({ userId: user._id || user.id, ip: requestMeta.ip });

  const boundEntity = await resolveBoundEntityId(user, params.entityId);
  const validated = validateImageUpload(params);
  const contentType = validated.contentType;
  const fileSizeBytes = validated.fileSizeBytes;
  await assertDailyQuota(user._id || user.id, fileSizeBytes);

  const key = buildUploadKey("images", boundEntity, params.fileName, user._id || user.id);
  const expiresIn = clampPresignExpiry(params.expiresIn);

  let uploadUrl;
  try {
    uploadUrl = await getPresignedPutUrl(key, contentType, expiresIn);
  } catch (err) {
    throw wrapS3Error(err, { op: "getPresignedPutUrl", key, kind: "image" });
  }
  const fileUrl = getPublicUrl(key);

  logger.info("Image upload URL issued", {
    key,
    entityId: boundEntity,
    contentType,
    userId: user._id || user.id,
  });

  await logFileAccess({
    action: "PRESIGN_PUT",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    uploadId: mongoose.isValidObjectId(boundEntity) ? boundEntity : null,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
    meta: { contentType, kind: "image", expiresIn, fileSizeBytes, entityId: boundEntity },
  });

  return {
    uploadUrl,
    fileUrl,
    key,
    contentType,
    uploadHeaders: getPresignedPutUploadHeaders(contentType),
    bucket: getBucket(),
    confirmRequired: true,
    confirmPath: "POST /api/upload/confirm",
    expiresIn,
    watermarkPolicy: fileSecurity.getWatermarkPolicy(),
  };
}

/** H-10 authenticated, user-bound audio presign. */
async function getAudioUploadUrl(params, user, requestMeta = {}) {
  assertCanUpload(user);
  await assertUploadPresignAllowed({ userId: user._id || user.id, ip: requestMeta.ip });

  const boundEntity = await resolveBoundEntityId(user, params.entityId);
  const validated = validateAudioUpload(params);
  const contentType = validated.contentType;
  const fileSizeBytes = validated.fileSizeBytes;
  const fileName = validated.fileName || params.fileName;
  await assertDailyQuota(user._id || user.id, fileSizeBytes);

  const key = buildUploadKey("audio", boundEntity, fileName, user._id || user.id);
  const expiresIn = clampPresignExpiry(params.expiresIn);

  let uploadUrl;
  try {
    uploadUrl = await getPresignedPutUrl(key, contentType, expiresIn);
  } catch (err) {
    throw wrapS3Error(err, { op: "getPresignedPutUrl", key, kind: "audio" });
  }
  const fileUrl = getPublicUrl(key);

  logger.info("Audio upload URL issued", {
    key,
    entityId: boundEntity,
    contentType,
    userId: user._id || user.id,
  });

  await logFileAccess({
    action: "PRESIGN_PUT",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    uploadId: mongoose.isValidObjectId(boundEntity) ? boundEntity : null,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
    meta: { contentType, kind: "audio", expiresIn, fileSizeBytes, entityId: boundEntity },
  });

  return {
    uploadUrl,
    fileUrl,
    key,
    contentType,
    fileName,
    uploadHeaders: getPresignedPutUploadHeaders(contentType),
    bucket: getBucket(),
    confirmRequired: true,
    confirmPath: "POST /api/upload/confirm",
    expiresIn,
    watermarkPolicy: fileSecurity.getWatermarkPolicy(),
  };
}

async function deleteUpload(params, user, requestMeta = {}) {
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
  assertKeyOwnedByUser(key, user);
  try {
    await deleteObject(key);
  } catch (err) {
    throw wrapS3Error(err, { op: "deleteObject", key });
  }

  await logFileAccess({
    action: "DELETE",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
  });

  return { deleted: true, key };
}

async function confirmUpload(params, user, requestMeta = {}) {
  assertCanUpload(user);
  let key = params.key && String(params.key).trim();
  if (!key && params.fileUrl) {
    key = keyFromFileUrl(params.fileUrl);
  }
  if (!key) {
    throw new BadRequestError("key or fileUrl is required", {
      errors: [{ field: "key", message: "Required" }],
    });
  }
  assertUploadKey(key);
  assertKeyOwnedByUser(key, user);

  const contentType = params.contentType ? String(params.contentType).trim() : "";
  const fileName = params.fileName ? String(params.fileName).trim() : key.split("/").pop();
  const lowerName = fileName.toLowerCase();
  const prefixLen = lowerName.endsWith(".dxf") || lowerName.endsWith(".dwg") ? 128 : 64;

  let headerBytes;
  let meta;
  try {
    headerBytes = await getObjectPrefixBytes(key, prefixLen);
    meta = await headObject(key);
  } catch (err) {
    throw wrapS3Error(err, { op: "getObjectPrefixBytes/headObject", key });
  }

  if (params.fileSizeBytes != null && meta.contentLength != null) {
    const declared = Number(params.fileSizeBytes);
    if (Number.isFinite(declared) && Math.abs(declared - meta.contentLength) > 1) {
      throw new BadRequestError("Uploaded object size does not match declared fileSizeBytes", {
        code: "UPLOAD_SIZE_MISMATCH",
      });
    }
  }

  const header = fileSecurity.validateFileHeader(headerBytes, { contentType, fileName });
  const av = await fileSecurity.runAntivirusScan({
    key,
    contentType: contentType || header.detected,
    fileName,
    headerBytes,
  });

  if (!header.ok || !av.clean) {
    let quarantineKey = null;
    try {
      quarantineKey = await quarantineObject(key, header.code || "av_fail");
    } catch (err) {
      logger.error("quarantine failed", err, { key });
      try {
        await deleteObject(key);
      } catch (_) {
        /* ignore */
      }
    }
    await logFileAccess({
      action: "UPLOAD_QUARANTINED",
      actorUserId: user._id || user.id,
      actorRole: user.role,
      objectKey: key,
      success: false,
      code: header.code || "AV_REJECTED",
      ip: requestMeta.ip || null,
      userAgent: requestMeta.userAgent || null,
      meta: { quarantineKey, header, av },
    });
    throw new BadRequestError(header.reason || av.detail || "File quarantined", {
      code: "FILE_QUARANTINED",
      errors: [{ field: "file", message: "Failed security scan" }],
    });
  }

  const headerSha256 = crypto.createHash("sha256").update(headerBytes).digest("hex");
  const checksumPackage = {
    algorithm: "SHA256_HEADER_PREFIX",
    sha256: headerSha256,
    prefixBytes: headerBytes.length,
    contentLength: meta.contentLength,
    eTag: meta.eTag,
  };

  await logFileAccess({
    action: "UPLOAD_CONFIRM_OK",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
    meta: { detected: header.detected, avEngine: av.engine, checksumPackage },
  });

  return {
    confirmed: true,
    key,
    fileUrl: getPublicUrl(key),
    detectedType: header.detected,
    scanEngine: av.engine,
    sha256: headerSha256,
    contentLength: meta.contentLength,
    eTag: meta.eTag,
    checksumPackage,
    watermarkPolicy: fileSecurity.getWatermarkPolicy(),
  };
}

/** H-12: dedicated CAD deliverable presign (DWG/DXF source + PDF/image preview). */
async function getCadDeliverableUploadUrl(params, user, requestMeta = {}) {
  assertCanUpload(user);
  if (user.role !== USER_ROLES.CAD && user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("Only CAD operators can upload CAD deliverables", {
      code: "CAD_DELIVERABLE_ROLE_REQUIRED",
    });
  }
  await assertUploadPresignAllowed({ userId: user._id || user.id, ip: requestMeta.ip });

  const validated = cadDeliverableContract.assertCadDeliverablePresignParams(params);
  const boundEntity = await resolveBoundEntityId(user, params.entityId);
  await assertDailyQuota(user._id || user.id, validated.fileSizeBytes);

  const key = buildUploadKey(
    "cad-deliverables",
    boundEntity,
    params.fileName,
    user._id || user.id
  );
  const expiresIn = clampPresignExpiry(params.expiresIn);

  let uploadUrl;
  try {
    uploadUrl = await getPresignedPutUrl(key, validated.contentType, expiresIn);
  } catch (err) {
    throw wrapS3Error(err, { op: "getPresignedPutUrl", key, kind: "cad-deliverable" });
  }

  await logFileAccess({
    action: "PRESIGN_PUT",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    uploadId: mongoose.isValidObjectId(boundEntity) ? boundEntity : null,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
    meta: {
      contentType: validated.contentType,
      kind: "cad-deliverable",
      role: validated.role,
      expiresIn,
      fileSizeBytes: validated.fileSizeBytes,
      contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION,
    },
  });

  return {
    uploadUrl,
    fileUrl: getPublicUrl(key),
    key,
    contentType: validated.contentType,
    role: validated.role,
    contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION,
    uploadHeaders: getPresignedPutUploadHeaders(validated.contentType),
    bucket: getBucket(),
    confirmRequired: true,
    confirmPath: "POST /api/upload/confirm",
    expiresIn,
    watermarkPolicy: fileSecurity.getWatermarkPolicy(),
  };
}

async function startCadDeliverableMultipart(params, user, requestMeta = {}) {
  assertCanUpload(user);
  if (user.role !== USER_ROLES.CAD && user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPER_ADMIN) {
    throw new ForbiddenError("Only CAD operators can upload CAD deliverables", {
      code: "CAD_DELIVERABLE_ROLE_REQUIRED",
    });
  }
  await assertUploadPresignAllowed({ userId: user._id || user.id, ip: requestMeta.ip });
  const validated = cadDeliverableContract.assertCadDeliverablePresignParams(params);
  const boundEntity = await resolveBoundEntityId(user, params.entityId);
  await assertDailyQuota(user._id || user.id, validated.fileSizeBytes);
  const key = buildUploadKey("cad-deliverables", boundEntity, params.fileName, user._id || user.id);
  let mp;
  try {
    mp = await createMultipartUpload(key, validated.contentType);
  } catch (err) {
    throw wrapS3Error(err, { op: "createMultipartUpload", key });
  }
  await logFileAccess({
    action: "PRESIGN_PUT",
    actorUserId: user._id || user.id,
    actorRole: user.role,
    objectKey: key,
    success: true,
    ip: requestMeta.ip || null,
    userAgent: requestMeta.userAgent || null,
    meta: {
      kind: "cad-deliverable-multipart",
      role: validated.role,
      uploadId: mp.uploadId,
      fileSizeBytes: validated.fileSizeBytes,
      contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION,
    },
  });
  return {
    multipart: true,
    uploadId: mp.uploadId,
    key,
    fileUrl: getPublicUrl(key),
    contentType: validated.contentType,
    role: validated.role,
    contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION,
    bucket: getBucket(),
    partSizeHintBytes: Number(process.env.CAD_MULTIPART_PART_SIZE_BYTES || 8 * 1024 * 1024),
    partUrlPath: "POST /api/upload/cad-deliverable/multipart/part",
    completePath: "POST /api/upload/cad-deliverable/multipart/complete",
    confirmRequired: true,
  };
}

async function getCadDeliverablePartUrl(params, user) {
  assertCanUpload(user);
  const key = String(params.key || "").trim();
  const uploadId = String(params.uploadId || "").trim();
  const partNumber = Number(params.partNumber);
  assertUploadKey(key);
  assertKeyOwnedByUser(key, user);
  if (!uploadId || !Number.isFinite(partNumber) || partNumber < 1) {
    throw new BadRequestError("uploadId and partNumber (>=1) are required");
  }
  const expiresIn = clampPresignExpiry(params.expiresIn);
  let url;
  try {
    url = await getPresignedUploadPartUrl(key, uploadId, partNumber, expiresIn);
  } catch (err) {
    throw wrapS3Error(err, { op: "getPresignedUploadPartUrl", key });
  }
  return { uploadUrl: url, key, uploadId, partNumber, expiresIn };
}

async function completeCadDeliverableMultipart(params, user, requestMeta = {}) {
  assertCanUpload(user);
  const key = String(params.key || "").trim();
  const uploadId = String(params.uploadId || "").trim();
  assertUploadKey(key);
  assertKeyOwnedByUser(key, user);
  try {
    await completeMultipartUpload(key, uploadId, params.parts || []);
  } catch (err) {
    throw wrapS3Error(err, { op: "completeMultipartUpload", key });
  }
  // Run same confirm gate
  return confirmUpload(
    {
      key,
      contentType: params.contentType,
      fileName: params.fileName,
      fileSizeBytes: params.fileSizeBytes,
    },
    user,
    requestMeta
  );
}

async function abortCadDeliverableMultipart(params, user) {
  assertCanUpload(user);
  const key = String(params.key || "").trim();
  const uploadId = String(params.uploadId || "").trim();
  assertUploadKey(key);
  assertKeyOwnedByUser(key, user);
  try {
    await abortMultipartUpload(key, uploadId);
  } catch (err) {
    throw wrapS3Error(err, { op: "abortMultipartUpload", key });
  }
  return { aborted: true, key };
}

async function getImageUploadUrls(params, user, requestMeta = {}) {
  assertCanUpload(user);
  const entityId = params.entityId;
  const expiresIn = clampPresignExpiry(params.expiresIn);
  const files = [];
  for (const item of params.files || []) {
    // eslint-disable-next-line no-await-in-loop
    const result = await getImageUploadUrl(
      { ...item, entityId, expiresIn },
      user,
      requestMeta
    );
    files.push(result);
  }
  return { files, entityId: entityId || "misc", bucket: getBucket() };
}

async function getAudioUploadUrls(params, user, requestMeta = {}) {
  assertCanUpload(user);
  const entityId = params.entityId;
  const expiresIn = clampPresignExpiry(params.expiresIn);
  const files = [];
  for (const item of params.files || []) {
    // eslint-disable-next-line no-await-in-loop
    const result = await getAudioUploadUrl(
      { ...item, entityId, expiresIn },
      user,
      requestMeta
    );
    files.push(result);
  }
  return { files, entityId: entityId || "misc", bucket: getBucket() };
}

module.exports = {
  getImageUploadUrl,
  getAudioUploadUrl,
  getImageUploadUrls,
  getAudioUploadUrls,
  getCadDeliverableUploadUrl,
  startCadDeliverableMultipart,
  getCadDeliverablePartUrl,
  completeCadDeliverableMultipart,
  abortCadDeliverableMultipart,
  deleteUpload,
  confirmUpload,
  validateImageUpload,
  validateAudioUpload,
  UPLOAD_IMAGE_MIME_TYPES,
  UPLOAD_AUDIO_MIME_TYPES,
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
};
