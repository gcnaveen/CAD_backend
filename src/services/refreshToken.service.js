/**
 * Refresh token store — rotating, family reuse detection, revocable sessions (H-02 / M-12).
 */

const crypto = require("crypto");
const mongoose = require("mongoose");
const { REFRESH_TOKEN_TTL_MS } = require("../config/authSecurity");
const logger = require("../utils/logger");

const RefreshTokenSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    /** Session family — reuse of a rotated token revokes the whole family. */
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    /** SHA-256 of raw refresh token (never store raw). */
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
      index: true,
    },
    revokeReason: {
      type: String,
      default: null,
    },
    replacedByHash: {
      type: String,
      default: null,
    },
    /** Human-readable device/session name. */
    label: {
      type: String,
      default: "Session",
      maxlength: 120,
    },
    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
    lastUsedAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { timestamps: true, collection: "refresh_tokens" }
);

RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
RefreshTokenSchema.index({ user: 1, revokedAt: 1, expiresAt: 1 });

const RefreshToken =
  mongoose.models.RefreshToken || mongoose.model("RefreshToken", RefreshTokenSchema);

function hashToken(raw) {
  return crypto.createHash("sha256").update(String(raw), "utf8").digest("hex");
}

function generateRawRefreshToken() {
  return crypto.randomBytes(48).toString("base64url");
}

function newFamilyId() {
  return crypto.randomBytes(16).toString("hex");
}

function deriveSessionLabel(userAgent) {
  const ua = String(userAgent || "").trim();
  if (!ua) return "Session";
  const short = ua.slice(0, 80);
  if (/Mobile|Android|iPhone/i.test(ua)) return `Mobile · ${short}`;
  if (/Electron/i.test(ua)) return `Desktop app · ${short}`;
  return `Browser · ${short}`;
}

function getMaxSessionsPerUser() {
  const n = parseInt(process.env.AUTH_MAX_SESSIONS_PER_USER || "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

async function enforceSessionCap(userId) {
  const max = getMaxSessionsPerUser();
  const active = await RefreshToken.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();
  if (active.length <= max) return;
  const overflow = active.slice(0, active.length - max);
  const ids = overflow.map((r) => r._id);
  await RefreshToken.updateMany(
    { _id: { $in: ids } },
    { $set: { revokedAt: new Date(), revokeReason: "SESSION_CAP" } }
  );
}

async function issueRefreshToken(userId, meta = {}, { familyId = null } = {}) {
  const raw = generateRawRefreshToken();
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const fid = familyId || newFamilyId();
  const doc = await RefreshToken.create({
    user: userId,
    familyId: fid,
    tokenHash,
    expiresAt,
    userAgent: meta.userAgent || null,
    ip: meta.ip || null,
    label: deriveSessionLabel(meta.userAgent),
    lastUsedAt: new Date(),
  });
  await enforceSessionCap(userId);
  return {
    refreshToken: raw,
    expiresAt,
    sessionId: String(doc._id),
    familyId: fid,
  };
}

async function revokeFamily(familyId, reason = "FAMILY_REVOKED") {
  if (!familyId) return 0;
  const res = await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
  return res.modifiedCount || 0;
}

async function rotateRefreshToken(rawRefreshToken, meta = {}) {
  const tokenHash = hashToken(rawRefreshToken);
  const existing = await RefreshToken.findOne({ tokenHash });
  if (!existing) {
    return { ok: false, reason: "INVALID_REFRESH" };
  }

  // Reuse detection: presented a token that was already rotated/revoked.
  if (existing.revokedAt) {
    const n = await revokeFamily(existing.familyId, "REUSE_DETECTED");
    logger.warn("ALERT_REFRESH_REUSE", {
      alertType: "REFRESH_TOKEN_REUSE",
      severity: "high",
      userId: String(existing.user),
      familyId: existing.familyId,
      revokedFamilyCount: n,
      escalateTo: "security",
    });
    return { ok: false, reason: "REFRESH_REUSE_DETECTED" };
  }

  if (new Date(existing.expiresAt).getTime() < Date.now()) {
    existing.revokedAt = new Date();
    existing.revokeReason = "EXPIRED";
    await existing.save();
    return { ok: false, reason: "REFRESH_EXPIRED" };
  }

  existing.revokedAt = new Date();
  existing.revokeReason = "ROTATED";
  const next = await issueRefreshToken(existing.user, meta, { familyId: existing.familyId });
  existing.replacedByHash = hashToken(next.refreshToken);
  await existing.save();

  return {
    ok: true,
    userId: existing.user,
    refreshToken: next.refreshToken,
    expiresAt: next.expiresAt,
    sessionId: next.sessionId,
    familyId: next.familyId,
  };
}

async function revokeRefreshToken(rawRefreshToken, reason = "LOGOUT") {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await RefreshToken.updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
}

async function revokeAllForUser(userId, reason = "REVOKE_ALL") {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokeReason: reason } }
  );
}

async function listSessionsForUser(userId, { currentRawToken = null } = {}) {
  const currentHash = currentRawToken ? hashToken(currentRawToken) : null;
  const rows = await RefreshToken.find({
    user: userId,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .lean();

  return rows.map((r) => ({
    id: String(r._id),
    familyId: r.familyId,
    label: r.label || deriveSessionLabel(r.userAgent),
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
    lastUsedAt: r.lastUsedAt || r.createdAt,
    expiresAt: r.expiresAt,
    current: Boolean(currentHash && r.tokenHash === currentHash),
  }));
}

async function revokeSessionById(userId, sessionId, { allowRevokeCurrent = true } = {}) {
  const doc = await RefreshToken.findOne({ _id: sessionId, user: userId });
  if (!doc) return { ok: false, reason: "NOT_FOUND" };
  if (doc.revokedAt) return { ok: true, alreadyRevoked: true };
  doc.revokedAt = new Date();
  doc.revokeReason = "SESSION_REVOKED";
  await doc.save();
  // Also revoke other active tokens in the same family (rotated ancestors already revoked)
  await revokeFamily(doc.familyId, "SESSION_REVOKED");
  return { ok: true, sessionId: String(doc._id), allowRevokeCurrent };
}

module.exports = {
  RefreshToken,
  hashToken,
  generateRawRefreshToken,
  newFamilyId,
  deriveSessionLabel,
  getMaxSessionsPerUser,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  revokeFamily,
  listSessionsForUser,
  revokeSessionById,
};
