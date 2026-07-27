/**
 * Retention / deletion workflow helpers (H-07).
 * Ops run: node scripts/retention-purge.js --dry-run
 */

const { logFileAccess } = require("./fileAccessLog.service");

function getRetentionDays() {
  const n = Number(process.env.FILE_RETENTION_DAYS || 365);
  return Number.isFinite(n) && n > 0 ? n : 365;
}

function retentionCutoffDate(now = new Date()) {
  return new Date(now.getTime() - getRetentionDays() * 24 * 60 * 60 * 1000);
}

/**
 * Record a retention deletion (immutable audit). Caller deletes S3 + Mongo.
 */
async function recordRetentionDeletion({ actorUserId, objectKey, uploadId, meta }) {
  await logFileAccess({
    action: "RETENTION_DELETE",
    actorUserId: actorUserId || null,
    actorRole: "SYSTEM",
    objectKey: objectKey || null,
    uploadId: uploadId || null,
    success: true,
    code: "RETENTION_SCHEDULE",
    meta: { retentionDays: getRetentionDays(), ...(meta || {}) },
  });
}

module.exports = {
  getRetentionDays,
  retentionCutoffDate,
  recordRetentionDeletion,
};
