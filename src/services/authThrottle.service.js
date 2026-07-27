/**
 * Mongo-backed auth throttle / lockout (audit H-02).
 * Works on Lambda without Redis.
 */

const mongoose = require("mongoose");
const {
  LOGIN_MAX_FAILURES,
  LOGIN_WINDOW_MS,
  LOGIN_LOCKOUT_MS,
  OTP_MAX_ISSUES,
  OTP_ISSUE_WINDOW_MS,
  OTP_MAX_VERIFY_FAILURES,
} = require("../config/authSecurity");
const { TooManyRequestsError } = require("../utils/errors");

const AuthThrottleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    kind: { type: String, required: true, index: true },
    count: { type: Number, default: 0 },
    windowStartedAt: { type: Date, default: () => new Date() },
    lockedUntil: { type: Date, default: null },
  },
  { timestamps: true, collection: "auth_throttles" }
);

AuthThrottleSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });

const AuthThrottle =
  mongoose.models.AuthThrottle || mongoose.model("AuthThrottle", AuthThrottleSchema);

function makeKey(kind, parts) {
  return `${kind}:${parts.filter(Boolean).map((p) => String(p).toLowerCase().trim()).join("|")}`;
}

async function assertNotLocked(key) {
  const row = await AuthThrottle.findOne({ key }).lean();
  if (row?.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now()) {
    const retryAfterSec = Math.ceil((new Date(row.lockedUntil).getTime() - Date.now()) / 1000);
    throw new TooManyRequestsError("Too many attempts. Try again later.", {
      code: "AUTH_LOCKED",
      errors: [{ retryAfterSeconds: retryAfterSec }],
    });
  }
}

async function bumpFailure(key, kind, { maxFailures, windowMs, lockoutMs }) {
  const now = Date.now();
  let row = await AuthThrottle.findOne({ key });
  if (!row) {
    row = await AuthThrottle.create({
      key,
      kind,
      count: 1,
      windowStartedAt: new Date(now),
      lockedUntil: null,
    });
    return row;
  }

  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > now) {
    const retryAfterSec = Math.ceil((new Date(row.lockedUntil).getTime() - now) / 1000);
    throw new TooManyRequestsError("Too many attempts. Try again later.", {
      code: "AUTH_LOCKED",
      errors: [{ retryAfterSeconds: retryAfterSec }],
    });
  }

  const windowStart = row.windowStartedAt ? new Date(row.windowStartedAt).getTime() : 0;
  if (!windowStart || now - windowStart > windowMs) {
    row.count = 1;
    row.windowStartedAt = new Date(now);
    row.lockedUntil = null;
  } else {
    row.count = (row.count || 0) + 1;
  }

  if (row.count >= maxFailures) {
    row.lockedUntil = new Date(now + lockoutMs);
  }
  await row.save();

  if (row.lockedUntil && new Date(row.lockedUntil).getTime() > now) {
    const retryAfterSec = Math.ceil((new Date(row.lockedUntil).getTime() - now) / 1000);
    throw new TooManyRequestsError("Too many attempts. Try again later.", {
      code: "AUTH_LOCKED",
      errors: [{ retryAfterSeconds: retryAfterSec }],
    });
  }
  return row;
}

async function clearThrottle(key) {
  await AuthThrottle.deleteOne({ key });
}

async function assertLoginAllowed({ ip, identifier }) {
  const key = makeKey("login", [identifier || "unknown", ip || "noip"]);
  await assertNotLocked(key);
  return key;
}

async function recordLoginFailure(key) {
  return bumpFailure(key, "login", {
    maxFailures: LOGIN_MAX_FAILURES,
    windowMs: LOGIN_WINDOW_MS,
    lockoutMs: LOGIN_LOCKOUT_MS,
  });
}

async function recordLoginSuccess(key) {
  await clearThrottle(key);
}

async function assertOtpIssueAllowed({ phone, ip }) {
  const key = makeKey("otp_issue", [phone, ip || "noip"]);
  await assertNotLocked(key);
  // Treat each issue as a "failure" toward rate limit (send throttle).
  await bumpFailure(key, "otp_issue", {
    maxFailures: OTP_MAX_ISSUES,
    windowMs: OTP_ISSUE_WINDOW_MS,
    lockoutMs: LOGIN_LOCKOUT_MS,
  });
  return key;
}

async function assertOtpVerifyAllowed({ phone, ip }) {
  const key = makeKey("otp_verify", [phone, ip || "noip"]);
  await assertNotLocked(key);
  return key;
}

async function recordOtpVerifyFailure(key) {
  return bumpFailure(key, "otp_verify", {
    maxFailures: OTP_MAX_VERIFY_FAILURES,
    windowMs: OTP_ISSUE_WINDOW_MS,
    lockoutMs: LOGIN_LOCKOUT_MS,
  });
}

async function recordOtpVerifySuccess(key) {
  await clearThrottle(key);
}

/** H-10: rate-limit presigned URL issuance per user. */
async function assertUploadPresignAllowed({ userId, ip }) {
  const max = Number(process.env.UPLOAD_PRESIGN_MAX_PER_WINDOW || 40);
  const windowMs = Number(process.env.UPLOAD_PRESIGN_WINDOW_MS || 15 * 60 * 1000);
  const lockoutMs = Number(process.env.UPLOAD_PRESIGN_LOCKOUT_MS || 15 * 60 * 1000);
  const key = makeKey("upload_presign", [userId, ip || "noip"]);
  await assertNotLocked(key);
  await bumpFailure(key, "upload_presign", {
    maxFailures: max,
    windowMs,
    lockoutMs,
  });
  return key;
}

module.exports = {
  assertLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  assertOtpIssueAllowed,
  assertOtpVerifyAllowed,
  recordOtpVerifyFailure,
  recordOtpVerifySuccess,
  assertUploadPresignAllowed,
};
