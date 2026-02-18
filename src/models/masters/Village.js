/**
 * Village master – belongs to a Hobli (District → Taluka → Hobli → Village).
 * Used by surveyor sketch upload for survey info.
 * Production: compound indexes for list by hobli and unique (hobliId + code).
 */
const mongoose = require("mongoose");
const { MASTER_STATUS } = require("../../config/constants");

const VillageSchema = new mongoose.Schema(
  {
    hobliId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hobli",
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

VillageSchema.index({ hobliId: 1, code: 1 }, { unique: true });
VillageSchema.index({ hobliId: 1, status: 1, name: 1 });

module.exports =
  mongoose.models.Village || mongoose.model("Village", VillageSchema);
