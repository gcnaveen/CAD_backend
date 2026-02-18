/**
 * Taluka model – belongs to District (District → Taluka → Hobli → Village).
 * Production: compound indexes for list by district and unique (districtId + code).
 */
const mongoose = require("mongoose");
const { MASTER_STATUS } = require("../../config/constants");

const TalukaSchema = new mongoose.Schema(
  {
    districtId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "District",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: Object.values(MASTER_STATUS),
      default: MASTER_STATUS.ACTIVE,
      index: true,
    },
  },
  { timestamps: true }
);

TalukaSchema.index({ districtId: 1, code: 1 }, { unique: true });
TalukaSchema.index({ districtId: 1, status: 1, name: 1 });

module.exports = mongoose.models.Taluka || mongoose.model("Taluka", TalukaSchema);
