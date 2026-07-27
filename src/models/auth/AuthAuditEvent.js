/**
 * Attributable auth audit events (audit H-01).
 * Named admin/surveyor logins produce durable records — not shared anonymous credentials.
 */

const mongoose = require("mongoose");

const AUTH_AUDIT_EVENT = Object.freeze({
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  TOKEN_ISSUED: "TOKEN_ISSUED",
});

const AuthAuditEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: Object.values(AUTH_AUDIT_EVENT),
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    role: { type: String, default: null, index: true },
    /** Email or phone used at login (identifier for accountability). */
    identifier: { type: String, default: null, index: true },
    success: { type: Boolean, required: true, index: true },
    reason: { type: String, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    strict: true,
    collection: "auth_audit_events",
  }
);

AuthAuditEventSchema.index({ createdAt: -1 });
AuthAuditEventSchema.index({ identifier: 1, createdAt: -1 });

module.exports =
  mongoose.models.AuthAuditEvent || mongoose.model("AuthAuditEvent", AuthAuditEventSchema);

module.exports.AUTH_AUDIT_EVENT = AUTH_AUDIT_EVENT;
