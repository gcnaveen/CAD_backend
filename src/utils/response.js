/**
 * Lambda HTTP response helpers (API Gateway HTTP API v2 friendly).
 *
 * Design goals (enterprise-grade):
 * - Single place for response shape and default headers
 * - Consistent JSON envelope for success/error
 * - Safe error serialization (no stack traces in prod)
 * - Easy override of headers/status/content-type
 */

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = String(v);
  return out;
}

function defaultCorsHeaders() {
  // NOTE: For cookie-based auth you must NOT use "*".
  const allowOrigin = process.env.CORS_ALLOW_ORIGIN || "*";
  return {
    "access-control-allow-origin": allowOrigin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
  };
}

function response(statusCode, body, { headers, isBase64Encoded } = {}) {
  return {
    statusCode,
    headers: headers || {},
    body: body ?? "",
    ...(typeof isBase64Encoded === "boolean" ? { isBase64Encoded } : null),
  };
}

function json(statusCode, payload, headers) {
  const base = {
    "content-type": "application/json; charset=utf-8",
    ...defaultCorsHeaders(),
  };
  return response(statusCode, JSON.stringify(payload ?? null), {
    headers: { ...base, ...normalizeHeaders(headers) },
  });
}

function text(statusCode, body, contentType, headers) {
  const base = {
    "content-type": contentType || "text/plain; charset=utf-8",
    ...defaultCorsHeaders(),
  };
  return response(statusCode, body == null ? "" : String(body), {
    headers: { ...base, ...normalizeHeaders(headers) },
  });
}

function ok(data, meta) {
  return json(200, { success: true, data, ...(meta ? { meta } : null) });
}

function created(data, meta) {
  return json(201, { success: true, data, ...(meta ? { meta } : null) });
}

/**
 * error(...) supports both:
 * - error(statusCode, message)
 * - error({ statusCode, message, errors, code })
 */
function error(arg1, arg2) {
  if (typeof arg1 === "number") {
    return json(arg1, { success: false, message: arg2 || "Error" });
  }

  const {
    statusCode = 500,
    message = "Internal Server Error",
    errors = null,
    code,
  } = arg1 || {};

  return json(statusCode, {
    success: false,
    message,
    ...(code ? { code } : null),
    ...(errors ? { errors } : null),
  });
}

module.exports = {
  response,
  json,
  text,
  ok,
  created,
  error,
};
