// models/Taluka.js
const mongoose = require("mongoose");

const TalukaSchema = new mongoose.Schema(
  {
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

// No duplicate taluka code under same district
TalukaSchema.index({ districtId: 1, code: 1 }, { unique: true });

module.exports = mongoose.models.Taluka || mongoose.model("Taluka", TalukaSchema);
