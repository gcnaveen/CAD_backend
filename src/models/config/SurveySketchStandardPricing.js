const mongoose = require("mongoose");

const PRICING_KEY = "STANDARD_SKETCH_PRICING";

const SurveySketchStandardPricingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: PRICING_KEY,
      unique: true,
      index: true,
      immutable: true,
    },
    sketchUploadPlanAmountRupees: { type: Number, default: null },
    sketchUploadDiscountRupees: { type: Number, default: null },
    sketchRevisionPlanAmountRupees: { type: Number, default: null },
    sketchRevisionDiscountRupees: { type: Number, default: null },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, strict: true, collection: "survey_sketch_standard_pricing" }
);

SurveySketchStandardPricingSchema.statics.pricingKey = PRICING_KEY;

module.exports =
  mongoose.models.SurveySketchStandardPricing ||
  mongoose.model("SurveySketchStandardPricing", SurveySketchStandardPricingSchema);
