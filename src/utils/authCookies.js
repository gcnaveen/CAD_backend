/**
 * M-02: HttpOnly refresh cookies + CSRF double-submit helpers.
 * Access token stays in JSON (FE should keep it in memory, not localStorage).
 */

const crypto = require("crypto");
const { REFRESH_TOKEN_TTL_MS } = require("../config/authSecurity");
const { isProductionRuntime } = require("../config/authSecurity");

const REFRESH_COOKIE = process.env.AUTH_REFRESH_COOKIE_NAME || "cad_refresh";
const CSRF_COOKIE = process.env.AUTH_CSRF_COOKIE_NAME || "cad_csrf";

function useRefreshCookie() {
  return String(process.env.AUTH_USE_REFRESH_COOKIE || "true").toLowerCase() !== "false";
}

function omitRefreshInBody() {
  return String(process.env.AUTH_OMIT_REFRESH_IN_BODY || "false").toLowerCase() === "true";
}

function cookieSecure() {
  if (String(process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "true") return true;
  if (String(process.env.AUTH_COOKIE_SECURE || "").toLowerCase() === "false") return false;
  return isProductionRuntime();
}

function cookieSameSite() {
  // Cross-origin FE (e.g. north-cot.com) → execute-api host needs None; Lax is fine for same-site.
  const raw = String(process.env.AUTH_COOKIE_SAMESITE || "").trim();
  if (raw) return raw;
  // Secure cookies in prod/staging: default None so SPA↔API refresh works cross-site.
  return cookieSecure() ? "None" : "Lax";
}

function cookieDomain() {
  const d = String(process.env.AUTH_COOKIE_DOMAIN || "").trim();
  return d || null;
}

function refreshCookieMaxAgeSec() {
  return Math.max(60, Math.floor(REFRESH_TOKEN_TTL_MS / 1000));
}

function parseCookieHeader(event) {
  const headers = event?.headers || {};
  const raw = headers.cookie || headers.Cookie || "";
  const out = {};
  String(raw)
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .forEach((part) => {
      const i = part.indexOf("=");
      if (i < 0) return;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      try {
        out[k] = decodeURIComponent(v);
      } catch (_) {
        out[k] = v;
      }
    });
  return out;
}

function getRefreshTokenFromRequest(event, body = {}) {
  if (body?.refreshToken) return String(body.refreshToken);
  const cookies = parseCookieHeader(event);
  return cookies[REFRESH_COOKIE] || null;
}

function getCsrfFromRequest(event) {
  const headers = event?.headers || {};
  const header =
    headers["x-csrf-token"] ||
    headers["X-CSRF-Token"] ||
    headers["x-csrftoken"] ||
    null;
  const cookies = parseCookieHeader(event);
  return {
    header: header ? String(header) : null,
    cookie: cookies[CSRF_COOKIE] || null,
  };
}

function assertCsrfIfCookieAuth(event, body = {}) {
  if (!useRefreshCookie()) return;
  // Legacy body refresh without cookie still allowed unless omit-body mode forces cookies.
  if (body?.refreshToken && !omitRefreshInBody()) return;
  const cookies = parseCookieHeader(event);
  if (!cookies[REFRESH_COOKIE]) return;
  const { header, cookie } = getCsrfFromRequest(event);
  if (!header || !cookie || header !== cookie) {
    const { UnauthorizedError } = require("./errors");
    throw new UnauthorizedError("CSRF validation failed", { code: "CSRF_INVALID" });
  }
}

function buildCookie(name, value, { maxAge, httpOnly, clear = false } = {}) {
  const parts = [
    `${name}=${clear ? "" : encodeURIComponent(value)}`,
    "Path=/api/auth",
    `SameSite=${cookieSameSite()}`,
  ];
  if (clear) {
    parts.push("Max-Age=0");
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (maxAge != null) {
    parts.push(`Max-Age=${maxAge}`);
  }
  if (httpOnly) parts.push("HttpOnly");
  if (cookieSecure()) parts.push("Secure");
  const domain = cookieDomain();
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

function generateCsrfToken() {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Attach session cookies to a Lambda response; optionally strip refresh from JSON body.
 */
function attachSessionCookies(response, session) {
  if (!useRefreshCookie() || !session?.refreshToken) return response;
  const csrf = generateCsrfToken();
  const cookies = [
    buildCookie(REFRESH_COOKIE, session.refreshToken, {
      maxAge: refreshCookieMaxAgeSec(),
      httpOnly: true,
    }),
    buildCookie(CSRF_COOKIE, csrf, {
      maxAge: refreshCookieMaxAgeSec(),
      httpOnly: false,
    }),
  ];

  let body = response.body;
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body);
      if (parsed?.data && typeof parsed.data === "object") {
        parsed.data.csrfToken = csrf;
        parsed.data.authStorage = {
          accessToken: "memory",
          refreshToken: omitRefreshInBody() ? "httpOnlyCookie" : "httpOnlyCookie+bodyCompat",
          csrf: "cookie+header",
        };
        if (omitRefreshInBody()) {
          delete parsed.data.refreshToken;
        }
        body = JSON.stringify(parsed);
      }
    } catch (_) {
      /* leave body */
    }
  }

  return {
    ...response,
    body,
    cookies: [...(response.cookies || []), ...cookies],
  };
}

function clearSessionCookies(response) {
  if (!useRefreshCookie()) return response;
  const cookies = [
    buildCookie(REFRESH_COOKIE, "", { clear: true, httpOnly: true }),
    buildCookie(CSRF_COOKIE, "", { clear: true, httpOnly: false }),
  ];
  return {
    ...response,
    cookies: [...(response.cookies || []), ...cookies],
  };
}

module.exports = {
  REFRESH_COOKIE,
  CSRF_COOKIE,
  useRefreshCookie,
  omitRefreshInBody,
  parseCookieHeader,
  getRefreshTokenFromRequest,
  getCsrfFromRequest,
  assertCsrfIfCookieAuth,
  attachSessionCookies,
  clearSessionCookies,
  generateCsrfToken,
};
