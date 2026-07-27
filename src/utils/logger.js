/**
 * Structured logger (CloudWatch friendly) — M-07 correlation IDs + PII-safe meta.
 */

const { getCorrelationId } = require("./requestContext");

const isProduction = process.env.NODE_ENV === "production";
const isDev = !isProduction;

const LEVELS = Object.freeze({
  ERROR: "error",
  WARN: "warn",
  INFO: "info",
  DEBUG: "debug",
});

const PII_KEYS = new Set([
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "otp",
  "otpCode",
  "mfaSecret",
  "secret",
  "clientSecret",
  "phonepe",
]);

function redactValue(key, value) {
  const k = String(key || "").toLowerCase();
  if (PII_KEYS.has(k) || /password|secret|token|otp|authorization/i.test(k)) {
    return "[REDACTED]";
  }
  if (typeof value === "string" && value.length > 500) {
    return `${value.slice(0, 500)}…[truncated]`;
  }
  return value;
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Error)) {
      out[k] = sanitizeMeta(v);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

function baseMeta(meta) {
  const correlationId = getCorrelationId();
  return {
    ...(correlationId ? { correlationId } : {}),
    ...sanitizeMeta(meta),
  };
}

function format(level, message, meta) {
  const entry = {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    message,
    service: "cad-backend-api",
    stage: process.env.STAGE || null,
    ...baseMeta(meta),
  };

  if (isProduction) return JSON.stringify(entry);

  const metaStr = Object.keys(entry).some((k) => !["time", "level", "message", "service", "stage"].includes(k))
    ? ` ${JSON.stringify(baseMeta(meta))}`
    : "";
  return `[${entry.time}] ${entry.level}: ${entry.message}${metaStr}`;
}

function errorToMeta(err) {
  if (!err) return undefined;
  return {
    error: {
      name: err.name,
      message: err.message,
      code: err.code || null,
      stack: isDev ? err.stack : undefined,
    },
  };
}

const logger = {
  /**
   * Backward compatible: logger.error(msg), logger.error(msg, err), logger.error(msg, meta),
   * logger.error(msg, err, meta).
   */
  error(message, errOrMeta, maybeMeta) {
    let meta = {};
    if (errOrMeta instanceof Error) {
      meta = { ...(maybeMeta && typeof maybeMeta === "object" ? maybeMeta : {}), ...errorToMeta(errOrMeta) };
    } else if (errOrMeta && typeof errOrMeta === "object") {
      meta = sanitizeMeta(errOrMeta);
    }
    // eslint-disable-next-line no-console
    console.error(format(LEVELS.ERROR, message, meta));
  },
  warn(message, meta = {}) {
    // eslint-disable-next-line no-console
    console.warn(format(LEVELS.WARN, message, meta));
  },
  info(message, meta = {}) {
    // eslint-disable-next-line no-console
    console.log(format(LEVELS.INFO, message, meta));
  },
  debug(message, meta = {}) {
    if (!isDev) return;
    // eslint-disable-next-line no-console
    console.log(format(LEVELS.DEBUG, message, meta));
  },
};

module.exports = logger;
