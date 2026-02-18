// models/District.js
const mongoose = require("mongoose");

const DistrictSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true }, // e.g. "KA-BLR"
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE", index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.District || mongoose.model("District", DistrictSchema);
