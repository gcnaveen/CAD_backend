const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { USER_ROLES, USER_STATUS } = require("../../config/constants");
const { BCRYPT_COST } = require("../../config/authSecurity");

const AuthSchema = require("./subSchemas/Auth.schema");
const CadProfileSchema = require("./subSchemas/CadProfile.schema");
const SurveyorProfileSchema = require("./subSchemas/SurveyorProfile.schema");

const UserSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: Object.values(USER_ROLES),
    required: true,
    index: true,
    set: (v) => {
      if (v == null || v === "") return v;
      const { normalizeRole } = require("../../utils/roleNormalize");
      return normalizeRole(v) || String(v).trim().toUpperCase();
    },
  },
  status: {
    type: String,
    enum: Object.values(USER_STATUS),
    default: USER_STATUS.ACTIVE,
    index: true,
    set: (v) => (v == null || v === "" ? v : String(v).trim().toUpperCase()),
  },

  name: {
    first: { type: String, required: true, trim: true },
    last: { type: String, trim: true },
  },

  auth: {
    type: AuthSchema,
    required: true,
  },

  // -------- CAD extended profile fields (stored on User directly) --------
  // NOTE: These are intended for CAD users only; service layer enforces role checks.
  personalDetails: {
    firstName: { type: String, trim: true, default: null },
    lastName: { type: String, trim: true, default: null },
    phone: { type: String, trim: true, default: null },
    email: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    profilePhotoUrl: { type: String, trim: true, default: null },
  },
  kycDetails: {
    aadhaarPhotoUrl: { type: String, trim: true, default: null },
  },
  bankDetails: {
    accountNumber: { type: String, trim: true, default: null },
    accountHolderName: { type: String, trim: true, default: null },
    bankName: { type: String, trim: true, default: null },
    branchName: { type: String, trim: true, default: null },
    ifscCode: { type: String, trim: true, default: null },
  },
  upiDetails: {
    upiId: { type: String, trim: true, default: null },
  },
  professionalDetails: {
    skills: [{ type: String, trim: true }],
    experienceYears: { type: Number, min: 0, default: null },
    resumeUrl: { type: String, trim: true, default: null },
  },
  documents: {
    addressProofUrl: { type: String, trim: true, default: null },
  },
  profileCompleted: { type: Boolean, default: false },

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
  if (!this.isNew) {
    if (this.isModified("role")) {
      this.$locals = this.$locals || {};
      this.$locals.revokeSessionsReason = "ROLE_CHANGED";
    } else if (this.isModified("auth.password") && this.auth?.password) {
      this.$locals = this.$locals || {};
      this.$locals.revokeSessionsReason = "PASSWORD_CHANGED";
    }
  }
  if (!this.isModified("auth.password") || !this.auth?.password) return next();

  try {
    this.auth.password = await bcrypt.hash(this.auth.password, BCRYPT_COST);
    next();
  } catch (err) {
    next(err);
  }
});

/** M-12: invalidate refresh sessions on password / role change. */
UserSchema.post("save", async function (doc) {
  const reason = doc?.$locals?.revokeSessionsReason;
  if (!reason) return;
  try {
    const refreshTokenService = require("../services/refreshToken.service");
    await refreshTokenService.revokeAllForUser(doc._id, reason);
  } catch (_) {
    /* best-effort */
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

  // ADMIN / SUPER_ADMIN / CAD must have email + password (on create or password change only).
  // Password is select:false — partial updates (delete, block) must not re-validate missing hash.
  if ([USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN, USER_ROLES.CAD].includes(this.role)) {
    if (!this.auth?.email) {
      return next(new Error(`${this.role} must have email`));
    }
    if (this.isNew || this.isModified("auth.password")) {
      if (!this.auth?.password) {
        return next(new Error(`${this.role} must have password`));
      }
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
      delete ret.auth.mfaSecret;
    }
    return ret;
  },
});



module.exports = mongoose.models.User || mongoose.model("User", UserSchema);