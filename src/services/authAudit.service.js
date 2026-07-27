/**
 * Persist attributable login events (audit H-01).
 */

const AuthAuditEvent = require("../models/auth/AuthAuditEvent");
const { AUTH_AUDIT_EVENT } = require("../models/auth/AuthAuditEvent");
const logger = require("../utils/logger");

function extractRequestMeta(event) {
  if (!event || typeof event !== "object") {
    return { ip: null, userAgent: null, requestId: null };
  }
  const headers = event.headers || {};
  const userAgent = headers["user-agent"] || headers["User-Agent"] || null;
  const ip =
    event.requestContext?.http?.sourceIp ||
    event.requestContext?.identity?.sourceIp ||
    headers["x-forwarded-for"] ||
    headers["X-Forwarded-For"] ||
    null;
  const requestId =
    event.requestContext?.requestId ||
    event.requestContext?.http?.requestId ||
    headers["x-request-id"] ||
    null;
  return {
    ip: ip != null ? String(ip).split(",")[0].trim().slice(0, 128) : null,
    userAgent: userAgent != null ? String(userAgent).slice(0, 500) : null,
    requestId: requestId != null ? String(requestId).slice(0, 128) : null,
  };
}

async function recordLoginEvent({
  success,
  user = null,
  identifier = null,
  reason = null,
  requestMeta = {},
}) {
  try {
    // Never persist passwords or tokens. Identifier is email/phone for accountability only.
    const safeIdentifier =
      identifier != null ? String(identifier).toLowerCase().trim().slice(0, 200) : null;
    await AuthAuditEvent.create({
      type: success ? AUTH_AUDIT_EVENT.LOGIN_SUCCESS : AUTH_AUDIT_EVENT.LOGIN_FAILURE,
      userId: user?._id || null,
      role: user?.role || null,
      identifier: safeIdentifier,
      success: !!success,
      reason: reason != null ? String(reason).slice(0, 300) : null,
      ip: requestMeta.ip || null,
      userAgent: requestMeta.userAgent || null,
      requestId: requestMeta.requestId || null,
    });
  } catch (err) {
    // Audit failure must not break login or leak details to the client.
    logger.error("Failed to persist auth audit event", err, {
      success,
      hasIdentifier: !!identifier,
    });
  }
}

module.exports = {
  AUTH_AUDIT_EVENT,
  extractRequestMeta,
  recordLoginEvent,
};
