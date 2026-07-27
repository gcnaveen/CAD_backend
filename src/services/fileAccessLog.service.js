const FileAccessEvent = require("../models/security/FileAccessEvent");
const logger = require("../utils/logger");
const { getCorrelationId } = require("../utils/requestContext");

/**
 * Append immutable file access event. Never throws to callers (best-effort).
 */
async function logFileAccess({
  action,
  actorUserId = null,
  actorRole = null,
  objectKey = null,
  uploadId = null,
  success,
  code = null,
  meta = null,
  ip = null,
  userAgent = null,
}) {
  try {
    const correlationId = getCorrelationId();
    await FileAccessEvent.create({
      action,
      actorUserId,
      actorRole,
      objectKey,
      uploadId,
      success: Boolean(success),
      code,
      meta: {
        ...(meta && typeof meta === "object" ? meta : {}),
        ...(correlationId ? { correlationId } : {}),
      },
      ip,
      userAgent,
    });
  } catch (err) {
    logger.error("fileAccessLog write failed", err, { action, objectKey });
  }
}

module.exports = { logFileAccess, FileAccessEvent };
