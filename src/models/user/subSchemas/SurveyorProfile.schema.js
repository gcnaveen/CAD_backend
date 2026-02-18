const mongoose = require("mongoose");

const SurveyorProfileSchema = new mongoose.Schema({
  category: {
    type: String,
    enum: ["PUBLIC", "SURVEYOR"],
    required: true,
  },
  surveyType: {
    type: String,
    enum: ["LS", "GS"],
  },
  district: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "District",
    required: true,
  },
  taluka: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Taluka",
    required: true,
  },
}, { _id: false });

// Export Schema for use as embedded subdocument in User. Do not use as standalone Model.
module.exports = SurveyorProfileSchema;
