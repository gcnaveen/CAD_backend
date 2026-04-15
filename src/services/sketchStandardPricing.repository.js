/**
 * Singleton doc for admin standard sketch fees (upload + paid revision).
 * One-time copy from legacy fields on SurveySketchAssignmentFlow if present.
 */

const SurveySketchAssignmentFlow = require("../models/config/SurveySketchAssignmentFlow");
const SurveySketchStandardPricing = require("../models/config/SurveySketchStandardPricing");

const PRICING_KEY = SurveySketchStandardPricing.pricingKey;

function hasAnyPricingFields(doc) {
  if (!doc) return false;
  return (
    doc.sketchUploadPlanAmountRupees != null ||
    doc.sketchUploadDiscountRupees != null ||
    doc.sketchRevisionPlanAmountRupees != null ||
    doc.sketchRevisionDiscountRupees != null
  );
}

async function ensureLegacyPricingMigrated() {
  const existing = await SurveySketchStandardPricing.findOne({ key: PRICING_KEY }).lean();
  if (hasAnyPricingFields(existing)) return;

  const raw = await SurveySketchAssignmentFlow.collection.findOne({
    key: SurveySketchAssignmentFlow.flowKey,
  });
  if (!raw) return;

  const legacy = {
    sketchUploadPlanAmountRupees: raw.sketchUploadPlanAmountRupees ?? null,
    sketchUploadDiscountRupees: raw.sketchUploadDiscountRupees ?? null,
    sketchRevisionPlanAmountRupees: raw.sketchRevisionPlanAmountRupees ?? null,
    sketchRevisionDiscountRupees: raw.sketchRevisionDiscountRupees ?? null,
  };
  if (!Object.values(legacy).some((v) => v != null)) return;

  await SurveySketchStandardPricing.findOneAndUpdate(
    { key: PRICING_KEY },
    {
      $set: { ...legacy, updatedBy: raw.updatedBy || null },
      $setOnInsert: { key: PRICING_KEY },
    },
    { upsert: true }
  );
}

async function getStandardPricingLean() {
  await ensureLegacyPricingMigrated();
  return SurveySketchStandardPricing.findOne({ key: PRICING_KEY }).lean();
}

module.exports = {
  PRICING_KEY,
  ensureLegacyPricingMigrated,
  getStandardPricingLean,
};
