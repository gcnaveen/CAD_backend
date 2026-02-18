/**
 * CAD Center Model – production-ready.
 * Represents a CAD center with member statistics and availability tracking.
 * Indexed for list (deletedAt + status + name), lookup by code, and filter by status/creator.
 */

const mongoose = require("mongoose");
const { USER_STATUS, MASTER_STATUS } = require("../../config/constants");

const CadCenterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      index: true,
    },
    code: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      uppercase: true,
      maxlength: 50,
      index: true,
      description: "Unique code/identifier for the CAD center (e.g., 'BLR-CAD-001')",
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1000,
    },
    address: {
      street: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 100 },
      state: { type: String, trim: true, maxlength: 100 },
      pincode: { type: String, trim: true, maxlength: 10 },
      country: { type: String, trim: true, maxlength: 100, default: "India" },
    },
    contact: {
      email: {
        type: String,
        lowercase: true,
        trim: true,
        maxlength: 150,
        index: true,
      },
      phone: {
        type: String,
        trim: true,
        maxlength: 20,
      },
      alternatePhone: {
        type: String,
        trim: true,
        maxlength: 20,
      },
    },
    status: {
      type: String,
      enum: Object.values(MASTER_STATUS),
      default: MASTER_STATUS.ACTIVE,
      index: true,
    },
    capacity: {
      type: Number,
      min: 0,
      default: null,
      description: "Maximum number of CAD users this center can accommodate (null = unlimited)",
    },
    metadata: {
      establishedDate: { type: Date },
      notes: { type: String, maxlength: 500 },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
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
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// -------- Indexes (optimized for list, get-by-code, and filters) --------
CadCenterSchema.index({ deletedAt: 1, status: 1, name: 1 });
CadCenterSchema.index({ code: 1 }, { sparse: true });
CadCenterSchema.index({ status: 1, deletedAt: 1 });
CadCenterSchema.index({ createdBy: 1, deletedAt: 1 });

// -------- Virtuals: Member Statistics (computed from User collection) --------

/**
 * Total number of CAD users assigned to this center (active only).
 */
CadCenterSchema.virtual("totalMembers", {
  ref: "User",
  localField: "_id",
  foreignField: "cadProfile.cadCenter",
  count: true,
  match: { status: USER_STATUS.ACTIVE, deletedAt: null },
});

/**
 * Number of available CAD users (status: AVAILABLE).
 */
CadCenterSchema.virtual("availableMembers", {
  ref: "User",
  localField: "_id",
  foreignField: "cadProfile.cadCenter",
  count: true,
  match: {
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
    "cadProfile.availabilityStatus": "AVAILABLE",
  },
});

/**
 * Number of busy CAD users (status: BUSY).
 */
CadCenterSchema.virtual("busyMembers", {
  ref: "User",
  localField: "_id",
  foreignField: "cadProfile.cadCenter",
  count: true,
  match: {
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
    "cadProfile.availabilityStatus": "BUSY",
  },
});

/**
 * Number of offline CAD users (status: OFFLINE).
 */
CadCenterSchema.virtual("offlineMembers", {
  ref: "User",
  localField: "_id",
  foreignField: "cadProfile.cadCenter",
  count: true,
  match: {
    status: USER_STATUS.ACTIVE,
    deletedAt: null,
    "cadProfile.availabilityStatus": "OFFLINE",
  },
});

// -------- Instance Methods --------

/**
 * Get real-time member statistics (populates virtuals with actual counts).
 * Use this when you need current counts (virtuals are lazy-loaded).
 *
 * @returns {Promise<{ totalMembers: number, availableMembers: number, busyMembers: number, offlineMembers: number }>}
 */
CadCenterSchema.methods.getMemberStats = async function () {
  const User = mongoose.model("User");
  const centerId = this._id;

  const [total, available, busy, offline] = await Promise.all([
    User.countDocuments({
      role: "CAD",
      status: USER_STATUS.ACTIVE,
      deletedAt: null,
      "cadProfile.cadCenter": centerId,
    }),
    User.countDocuments({
      role: "CAD",
      status: USER_STATUS.ACTIVE,
      deletedAt: null,
      "cadProfile.cadCenter": centerId,
      "cadProfile.availabilityStatus": "AVAILABLE",
    }),
    User.countDocuments({
      role: "CAD",
      status: USER_STATUS.ACTIVE,
      deletedAt: null,
      "cadProfile.cadCenter": centerId,
      "cadProfile.availabilityStatus": "BUSY",
    }),
    User.countDocuments({
      role: "CAD",
      status: USER_STATUS.ACTIVE,
      deletedAt: null,
      "cadProfile.cadCenter": centerId,
      "cadProfile.availabilityStatus": "OFFLINE",
    }),
  ]);

  return {
    totalMembers: total,
    availableMembers: available,
    busyMembers: busy,
    offlineMembers: offline,
  };
};

/**
 * Check if center has capacity available (if capacity is set).
 * @returns {Promise<boolean>}
 */
CadCenterSchema.methods.hasCapacity = async function () {
  if (this.capacity == null) return true;
  const stats = await this.getMemberStats();
  return stats.totalMembers < this.capacity;
};

// -------- Static Methods --------

/**
 * Find active CAD centers (not deleted).
 */
CadCenterSchema.statics.findActive = function () {
  return this.find({ status: MASTER_STATUS.ACTIVE, deletedAt: null });
};

/**
 * Find by code (case-insensitive).
 */
CadCenterSchema.statics.findByCode = function (code) {
  return this.findOne({ code: code.toUpperCase().trim(), deletedAt: null });
};

// -------- Pre-save Hook --------

CadCenterSchema.pre("save", function (next) {
  if (this.isModified("code") && this.code) {
    this.code = this.code.toUpperCase().trim();
  }
  next();
});

// -------- Query Helpers --------

// Exclude soft-deleted by default
CadCenterSchema.query.active = function () {
  return this.where({ deletedAt: null });
};

module.exports = mongoose.models.CadCenter || mongoose.model("CadCenter", CadCenterSchema);
