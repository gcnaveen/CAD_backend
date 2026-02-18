const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { USER_ROLES, USER_STATUS } = require("../../config/constants");

const AuthSchema = require("./subSchemas/Auth.schema");
const CadProfileSchema = require("./subSchemas/CadProfile.schema");
const SurveyorProfileSchema = require("./subSchemas/SurveyorProfile.schema");

const UserSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: Object.values(USER_ROLES),
    required: true,
    index: true,
  },
  status: {
    type: String,
    enum: Object.values(USER_STATUS),
    default: USER_STATUS.ACTIVE,
    index: true,
  },

  name: {
    first: { type: String, required: true, trim: true },
    last: { type: String, trim: true },
  },

  auth: {
    type: AuthSchema,
    required: true,
  },

  cadProfile: {
    type: CadProfileSchema,
    default: null,
  },

  surveyorProfile: {
    type: SurveyorProfileSchema,
    default: null,
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

}, { timestamps: true });
// ... schema definition above ...

// -------- Indexes --------

// Unique email when present (Admin, SuperAdmin, CAD)
UserSchema.index(
  { "auth.email": 1 },
  { unique: true, sparse: true }
);

// Unique phone when present (Surveyor OTP login)
UserSchema.index(
  { "auth.phone": 1 },
  { unique: true, sparse: true }
);

// Common query patterns
UserSchema.index({ role: 1, status: 1 });

// CAD assignment queries
UserSchema.index({ "cadProfile.cadCenter": 1, status: 1 });
UserSchema.index({ "cadProfile.availabilityStatus": 1, status: 1 });

// Surveyor filters
UserSchema.index({ "surveyorProfile.category": 1 });
UserSchema.index({ "surveyorProfile.surveyType": 1 });
UserSchema.index({ "surveyorProfile.district": 1 });
UserSchema.index({ "surveyorProfile.taluka": 1 });

// List queries: exclude deleted, filter by role/status
UserSchema.index({ deletedAt: 1, role: 1, status: 1 });
UserSchema.index({ deletedAt: 1, "cadProfile.cadCenter": 1, status: 1 });

// -------- Password Hash Hook --------
UserSchema.pre("save", async function (next) {
  if (!this.isModified("auth.password") || !this.auth?.password) return next();

  try {
    this.auth.password = await bcrypt.hash(this.auth.password, 12);
    next();
  } catch (err) {
    next(err);
  }
});

// -------- Role-Based Validation Hook --------
UserSchema.pre("validate", function (next) {
  // CAD may have cadProfile with optional cadCenter (can be set later via patch)
  if (this.role === USER_ROLES.CAD) {
    // cadProfile/cadCenter optional at creation
  } else {
    this.cadProfile = null;
  }

  // SURVEYOR: phone required; profile can be filled later via "update profile" API
  if (this.role === USER_ROLES.SURVEYOR) {
    if (!this.auth?.phone) {
      return next(new Error("Surveyor must have phone number"));
    }
    const verified = Boolean(this.auth?.otpVerified);
    if (!verified) {
      this.surveyorProfile = null;
      return next();
    }
    // After OTP verified, profile may still be null until they call "update profile"
    if (!this.surveyorProfile) return next();
    const sp = this.surveyorProfile;
    if (!sp.district || !sp.taluka) {
      return next(new Error("Surveyor profile must have district, taluka"));
    }
    if (sp.category === "SURVEYOR" && !sp.surveyType) {
      return next(new Error("Surveyor type (LS/GS) is required when category is SURVEYOR"));
    }
    if (sp.category === "PUBLIC") {
      sp.surveyType = undefined;
    }
  } else {
    this.surveyorProfile = null;
  }

  // ADMIN / SUPER_ADMIN / CAD must have email + password
  if ([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CAD].includes(this.role)) {
    if (!this.auth?.email) {
      return next(new Error(`${this.role} must have email`));
    }
    if (!this.auth?.password) {
      return next(new Error(`${this.role} must have password`));
    }
  }

  next();
});

// -------- Methods --------
UserSchema.methods.comparePassword = async function comparePassword(plainPassword) {
  if (!plainPassword || !this.auth?.password) return false;
  return bcrypt.compare(plainPassword, this.auth.password);
};
UserSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    delete ret.__v;
    if (ret.auth) {
      delete ret.auth.password;
      delete ret.auth.otpCode;
      delete ret.auth.otpExpires;
    }
    return ret;
  },
});



module.exports = mongoose.models.User || mongoose.model("User", UserSchema);