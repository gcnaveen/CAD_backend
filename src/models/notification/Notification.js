const mongoose = require("mongoose");
const { USER_ROLES } = require("../../config/constants");

const NotificationReadSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    readAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { _id: false }
);

const NotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    entityType: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    targetRoles: {
      type: [String],
      enum: Object.values(USER_ROLES),
      default: () => [],
      index: true,
    },
    targetUsers: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
      default: () => [],
      index: true,
    },
    readBy: {
      type: [NotificationReadSchema],
      default: () => [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

NotificationSchema.index({ targetRoles: 1, createdAt: -1, deletedAt: 1 });
NotificationSchema.index({ targetUsers: 1, createdAt: -1, deletedAt: 1 });
NotificationSchema.index({ type: 1, createdAt: -1, deletedAt: 1 });

module.exports = mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
