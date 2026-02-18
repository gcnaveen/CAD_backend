// models/Hobli.js
const mongoose = require("mongoose");

const HobliSchema = new mongoose.Schema(
  {
    talukaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Taluka",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

// No duplicate hobli code under same taluka
HobliSchema.index({ talukaId: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.Hobli || mongoose.model("Hobli", HobliSchema);
