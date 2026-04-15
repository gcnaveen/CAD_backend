const mongoose = require("mongoose");

const CadProfileSchema = new mongoose.Schema({
  cadCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CadCenter",
    required: false, // optional for now; can be made required later
    index: true,
  },
  skills: [{ type: String }],
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
  availabilityStatus: {
    type: String,
    enum: ["AVAILABLE", "BUSY", "OFFLINE"],
    default: "AVAILABLE",
    index: true,
  },
  rating: { type: Number, default: 0 },
  workload: { type: Number, default: 0 },
}, { _id: false });

// Export Schema for use as embedded subdocument in User. Do not use as standalone Model.
module.exports = CadProfileSchema;
