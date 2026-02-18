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
      minlength: 5,
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
  },
  { _id: false, minimize: false }
);

module.exports = AuthSchema;
