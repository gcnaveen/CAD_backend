const mongoose = require("mongoose");

const CadProfileSchema = new mongoose.Schema({
  cadCenter: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "CadCenter",
    required: false, // optional for now; can be made required later
    index: true,
  },
  skills: [{ type: String }],
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
