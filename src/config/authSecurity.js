/**
 * Auth security policy (audit H-02).
 */

function envInt(name, fallback) {
  const n = parseInt(process.env[name] || String(fallback), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Do not raise PASSWORD_MIN_LENGTH without a coordinated frontend change.
// FE login/register/enrollment cap and validate exactly 4 numeric digits.
const PASSWORD_MIN_LENGTH = envInt("PASSWORD_MIN_LENGTH", 4);
const PASSWORD_MAX_LENGTH = 128;
const BCRYPT_COST = envInt("BCRYPT_COST", 12);

const LOGIN_MAX_FAILURES = envInt("AUTH_LOGIN_MAX_FAILURES", 5);
const LOGIN_WINDOW_MS = envInt("AUTH_LOGIN_WINDOW_MS", 15 * 60 * 1000);
const LOGIN_LOCKOUT_MS = envInt("AUTH_LOGIN_LOCKOUT_MS", 30 * 60 * 1000);

const OTP_MAX_ISSUES = envInt("AUTH_OTP_MAX_ISSUES", 5);
const OTP_ISSUE_WINDOW_MS = envInt("AUTH_OTP_ISSUE_WINDOW_MS", 15 * 60 * 1000);
const OTP_MAX_VERIFY_FAILURES = envInt("AUTH_OTP_MAX_VERIFY_FAILURES", 5);

const ACCESS_TOKEN_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || "15m";
const REFRESH_TOKEN_TTL_MS = envInt("JWT_REFRESH_TTL_MS", 7 * 24 * 60 * 60 * 1000);
const MFA_PENDING_EXPIRES_IN = process.env.JWT_MFA_PENDING_EXPIRES_IN || "5m";

function isProductionRuntime() {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const stage = String(process.env.STAGE || "").toLowerCase();
  return nodeEnv === "production" || stage === "prod" || stage === "production";
}

module.exports = {
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  BCRYPT_COST,
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
  OTP_MAX_ISSUES,
  OTP_ISSUE_WINDOW_MS,
  OTP_MAX_VERIFY_FAILURES,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_TTL_MS,
  MFA_PENDING_EXPIRES_IN,
  isProductionRuntime,
};
