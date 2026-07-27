const mongoose = require("mongoose");

const AuthSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 150,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
    },
    password: {
      type: String,
      select: false,
      // Plain password min length enforced in validator (H-02); stored value is bcrypt hash.
      minlength: 4,
    },
    otpCode: {
      type: String,
      select: false,
    },
    otpExpires: {
      type: Date,
      select: false,
    },
    otpVerified: {
      type: Boolean,
      default: false,
    },
    /** Admin MFA (TOTP). */
    mfaEnabled: {
      type: Boolean,
      default: false,
    },
    mfaSecret: {
      type: String,
      select: false,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    lastLoginIp: {
      type: String,
      default: null,
    },
  },
  { _id: false, minimize: false }
);

module.exports = AuthSchema;
