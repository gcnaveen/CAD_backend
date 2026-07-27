/**
 * Admin audit trail writer (M-07) — append-only, PII-safe.
 */

const AdminAuditEvent = require("../models/security/AdminAuditEvent");
const logger = require("../utils/logger");
const { getCorrelationId } = require("../utils/requestContext");

async function recordAdminAction({
  action,
  actor = null,
  targetType = null,
  targetId = null,
  success = true,
  code = null,
  meta = null,
  ip = null,
  userAgent = null,
}) {
  try {
    await AdminAuditEvent.create({
      action: String(action).slice(0, 120),
      actorUserId: actor?._id || actor?.id || null,
      actorRole: actor?.role || null,
      targetType: targetType != null ? String(targetType).slice(0, 80) : null,
      targetId: targetId != null ? String(targetId).slice(0, 80) : null,
      success: Boolean(success),
      code: code != null ? String(code).slice(0, 80) : null,
      correlationId: getCorrelationId(),
      ip,
      userAgent,
      meta,
    });
  } catch (err) {
    logger.error("adminAudit write failed", err, { action });
  }
}

module.exports = { recordAdminAction, AdminAuditEvent };
