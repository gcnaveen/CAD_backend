/**
 * District model – top-level in District → Taluka → Hobli → Village hierarchy.
 * Production: indexed for list (status + name) and unique code.
 */
const mongoose = require("mongoose");
const { MASTER_STATUS } = require("../../config/constants");

const DistrictSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, index: true },
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

// List: filter by status, sort by name
DistrictSchema.index({ status: 1, name: 1 });

module.exports = mongoose.models.District || mongoose.model("District", DistrictSchema);
