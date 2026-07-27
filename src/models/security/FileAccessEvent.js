/**
 * Immutable file access / security audit log (H-07).
 * Append-only: no update/delete API.
 */

const mongoose = require("mongoose");

const FileAccessEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      index: true,
      enum: [
        "PRESIGN_PUT",
        "UPLOAD_CONFIRM_OK",
        "UPLOAD_QUARANTINED",
        "DOWNLOAD_ISSUED",
        "DOWNLOAD_DENIED",
        "DELETE",
        "RETENTION_DELETE",
        "ACCESS_DENIED_CROSS_USER",
      ],
    },
    actorUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    actorRole: { type: String, default: null, index: true },
    objectKey: { type: String, default: null, index: true },
    uploadId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    success: { type: Boolean, required: true, index: true },
    code: { type: String, default: null, index: true },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

FileAccessEventSchema.index({ createdAt: -1 });
FileAccessEventSchema.index({ objectKey: 1, createdAt: -1 });

// Harden: block updates via mongoose
FileAccessEventSchema.pre(["updateOne", "findOneAndUpdate", "updateMany"], function () {
  throw new Error("FileAccessEvent is append-only");
});

module.exports =
  mongoose.models.FileAccessEvent || mongoose.model("FileAccessEvent", FileAccessEventSchema);
