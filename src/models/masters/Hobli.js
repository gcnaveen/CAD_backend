/**
 * Hobli model – belongs to Taluka (District → Taluka → Hobli → Village).
 * Production: compound indexes for list by taluka and unique (talukaId + code).
 */
const mongoose = require("mongoose");
const { MASTER_STATUS } = require("../../config/constants");

const HobliSchema = new mongoose.Schema(
  {
    talukaId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Taluka",
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

HobliSchema.index({ talukaId: 1, code: 1 }, { unique: true });
HobliSchema.index({ talukaId: 1, status: 1, name: 1 });

module.exports = mongoose.models.Hobli || mongoose.model("Hobli", HobliSchema);
