/**
 * M-01: CORS allow-list + browser security headers for API responses.
 * Website HTML CSP/nonces remain FE/CDN ownership — see docs/FRONTEND_M01_CORS_SECURITY_HEADERS.md
 */

const DEFAULT_DEV_ORIGINS = Object.freeze([
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
]);

/**
 * Extra browser origins inferred from FE / payment redirect config.
 * Prevents the common footgun: PhonePe points at north-cot.com but CORS_ALLOW_ORIGINS
 * was left on localhost-only after M-01 (browser shows Axios "Network Error"; Lambda still runs).
 * Never introduces "*".
 */
function companionOrigins() {
  const keys = [
    "PUBLIC_FRONTEND_ORIGIN",
    "FRONTEND_ORIGIN",
    "CORS_EXTRA_ORIGINS",
    "PHONEPE_SUCCESS_REDIRECT_URL",
    "PHONEPE_FAILURE_REDIRECT_URL",
  ];
  const out = [];
  for (const key of keys) {
    const raw = String(process.env[key] || "").trim();
    if (!raw || raw === "*") continue;
    for (const part of raw.split(",")) {
      const piece = part.trim();
      if (!piece || piece === "*") continue;
      try {
        if (key === "CORS_EXTRA_ORIGINS" || key.endsWith("_ORIGIN")) {
          if (piece.includes("://")) {
            out.push(new URL(piece).origin);
          } else {
            out.push(piece.replace(/\/$/, ""));
          }
        } else {
          out.push(new URL(piece).origin);
        }
      } catch (_) {
        /* ignore malformed companion values */
      }
    }
  }
  return out;
}

function parseAllowlist() {
  const raw = String(process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ALLOW_ORIGIN || "").trim();
  let list = [];
  if (!raw || raw === "*") {
    // Fail closed in prod/staging until companions / explicit list fill origins.
    const stage = String(process.env.STAGE || process.env.NODE_ENV || "").toLowerCase();
    if (!(stage === "prod" || stage === "production" || stage === "staging")) {
      list = [...DEFAULT_DEV_ORIGINS];
    }
  } else {
    list = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((o) => o !== "*");
  }
  for (const origin of companionOrigins()) {
    if (origin && origin !== "*" && !list.includes(origin)) list.push(origin);
  }
  return list;
}

function getRequestOrigin(event) {
  const headers = event?.headers || {};
  return (
    headers.origin ||
    headers.Origin ||
    headers.ORIGIN ||
    null
  );
}

/**
 * Reflect Origin only when present in allow-list. Never returns "*".
 * @returns {string|null}
 */
function resolveAllowOrigin(event) {
  const allowlist = parseAllowlist();
  if (!allowlist.length) return null;
  const origin = getRequestOrigin(event);
  if (origin && allowlist.includes(origin)) return origin;
  // No Origin (curl/server-to-server) or unmatched: omit ACAO (browsers block; tools still work)
  return null;
}

/** API-safe security headers (JSON APIs; not a substitute for FE page CSP). */
function securityHeaders() {
  const csp =
    process.env.API_CONTENT_SECURITY_POLICY ||
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
  const headers = {
    "x-content-type-options": "nosniff",
    "referrer-policy": process.env.REFERRER_POLICY || "no-referrer",
    "permissions-policy":
      process.env.PERMISSIONS_POLICY ||
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    "x-frame-options": "DENY",
    "content-security-policy": csp,
    "cross-origin-opener-policy": "same-origin",
    "x-permitted-cross-domain-policies": "none",
  };
  const stage = String(process.env.STAGE || "").toLowerCase();
  if (stage === "prod" || stage === "production" || String(process.env.ENABLE_HSTS || "").toLowerCase() === "true") {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function corsHeadersForEvent(event) {
  const allowOrigin = resolveAllowOrigin(event);
  const cookieMode = String(process.env.AUTH_USE_REFRESH_COOKIE || "true").toLowerCase() !== "false";
  const out = {
    "access-control-allow-methods":
      process.env.CORS_ALLOW_METHODS || "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers":
      process.env.CORS_ALLOW_HEADERS ||
      "content-type,authorization,x-requested-with,x-csrf-token,x-correlation-id",
    "access-control-expose-headers":
      process.env.CORS_EXPOSE_HEADERS || "x-correlation-id",
    "access-control-max-age": process.env.CORS_MAX_AGE || "86400",
    vary: "Origin",
  };
  if (allowOrigin) {
    out["access-control-allow-origin"] = allowOrigin;
    if (cookieMode) {
      out["access-control-allow-credentials"] = "true";
    }
  }
  return out;
}

/**
 * Merge CORS + security headers onto a Lambda proxy response.
 */
function applySecurityHeaders(event, result) {
  if (!result || typeof result !== "object") return result;
  const existing = {};
  if (result.headers && typeof result.headers === "object") {
    for (const [k, v] of Object.entries(result.headers)) {
      existing[String(k).toLowerCase()] = String(v);
    }
  }
  if (existing["access-control-allow-origin"] === "*") {
    delete existing["access-control-allow-origin"];
  }

  const status = Number(result.statusCode) || 0;
  const isRedirect = status >= 300 && status < 400 && Boolean(existing.location);
  // PhonePe browser return: keep navigation clean — do not attach API CSP/COOP on 302s.
  if (isRedirect) {
    const merged = {
      location: existing.location,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      ...corsHeadersForEvent(event),
    };
    const allowOrigin = resolveAllowOrigin(event);
    if (allowOrigin) merged["access-control-allow-origin"] = allowOrigin;
    else delete merged["access-control-allow-origin"];
    if (existing["x-correlation-id"]) {
      merged["x-correlation-id"] = existing["x-correlation-id"];
    }
    return { ...result, headers: merged };
  }

  const isHtml = String(existing["content-type"] || "").toLowerCase().includes("text/html");
  const baseSecurity = securityHeaders();
  if (isHtml) {
    // Swagger UI needs CDN scripts; still block framing.
    baseSecurity["content-security-policy"] =
      process.env.HTML_CONTENT_SECURITY_POLICY ||
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://unpkg.com https://cdn.jsdelivr.net; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
  }

  const merged = {
    ...baseSecurity,
    ...corsHeadersForEvent(event),
    ...existing,
  };
  const allowOrigin = resolveAllowOrigin(event);
  if (allowOrigin) merged["access-control-allow-origin"] = allowOrigin;
  else delete merged["access-control-allow-origin"];

  return { ...result, headers: merged };
}

/** Deploy / release gate. */
function assertCorsConfigReady() {
  const stage = String(process.env.STAGE || "").toLowerCase();
  const raw = String(process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ALLOW_ORIGIN || "").trim();
  if (raw === "*") {
    const err = new Error("CORS_ALLOW_ORIGINS=* is forbidden (audit M-01)");
    err.code = "CORS_WILDCARD_FORBIDDEN";
    throw err;
  }
  const list = parseAllowlist();
  if ((stage === "prod" || stage === "production" || stage === "staging") && list.length === 0) {
    const err = new Error(
      "CORS allow-list empty for prod/staging (audit M-01). Set CORS_ALLOW_ORIGINS and/or PUBLIC_FRONTEND_ORIGIN / PhonePe redirect URLs."
    );
    err.code = "CORS_CONFIG_MISSING";
    throw err;
  }
  if (list.length === 0) {
    const err = new Error("CORS allow-list is empty after parsing (audit M-01)");
    err.code = "CORS_CONFIG_MISSING";
    throw err;
  }
  return list;
}

module.exports = {
  DEFAULT_DEV_ORIGINS,
  companionOrigins,
  parseAllowlist,
  getRequestOrigin,
  resolveAllowOrigin,
  securityHeaders,
  corsHeadersForEvent,
  applySecurityHeaders,
  assertCorsConfigReady,
};
