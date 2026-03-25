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
      // Plain password at create is exactly 4 chars (see validator); after save hook this holds a bcrypt hash (long).
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
  },
  { _id: false, minimize: false }
);

module.exports = AuthSchema;
