const mongoose = require("mongoose");

const CadInterestSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, trim: true, index: true },
    address: { type: String, required: true, trim: true },
    skills: {
      type: [String],
      required: true,
      validate: {
        validator(v) {
          return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim());
        },
        message: "skills must be a non-empty array of strings",
      },
    },
    yearsOfExperience: { type: Number, required: true, min: 0, max: 60 },
    resumeUrl: { type: String, required: false, trim: true },
  },
  { timestamps: true }
);

CadInterestSchema.index({ email: 1, phone: 1, createdAt: -1 });

module.exports =
  mongoose.models.CadInterest || mongoose.model("CadInterest", CadInterestSchema);

