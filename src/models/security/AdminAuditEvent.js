/**
 * Immutable admin / privileged action audit (M-07).
 */

const mongoose = require("mongoose");

const AdminAuditEventSchema = new mongoose.Schema(
  {
    action: { type: String, required: true, index: true, maxlength: 120 },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorRole: { type: String, default: null },
    targetType: { type: String, default: null },
    targetId: { type: String, default: null, index: true },
    success: { type: Boolean, required: true },
    code: { type: String, default: null },
    correlationId: { type: String, default: null, index: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    /** PII-safe metadata only */
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "admin_audit_events", strict: true }
);

AdminAuditEventSchema.index({ createdAt: -1 });

AdminAuditEventSchema.pre(["updateOne", "findOneAndUpdate", "updateMany", "deleteOne", "deleteMany"], function () {
  throw new Error("AdminAuditEvent is append-only");
});

const AdminAuditEvent =
  mongoose.models.AdminAuditEvent || mongoose.model("AdminAuditEvent", AdminAuditEventSchema);

module.exports = AdminAuditEvent;
