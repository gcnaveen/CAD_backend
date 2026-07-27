/**
 * Lambda HTTP response helpers (API Gateway HTTP API v2 friendly).
 *
 * CORS allow-list + security headers are applied in asyncHandler via httpSecurity
 * (audit M-01). Do not set Access-Control-Allow-Origin: * here.
 */

function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(headers)) out[String(k).toLowerCase()] = String(v);
  return out;
}

function defaultApiHeaders() {
  const { securityHeaders } = require("./httpSecurity");
  return {
    ...securityHeaders(),
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
    ...defaultApiHeaders(),
  };
  return response(statusCode, JSON.stringify(payload ?? null), {
    headers: { ...base, ...normalizeHeaders(headers) },
  });
}

function text(statusCode, body, contentType, headers) {
  const base = {
    "content-type": contentType || "text/plain; charset=utf-8",
    ...defaultApiHeaders(),
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

/** Browser redirect (PhonePe return URL, OAuth, etc.). */
function redirect(url, statusCode = 302) {
  const base = {
    Location: String(url),
    ...defaultApiHeaders(),
  };
  return response(statusCode, "", { headers: base });
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
  redirect,
  error,
};
