/**
 * Admin standard sketch pricing (upload + paid revision #2+).
 * Stored on SurveySketchStandardPricing only — not on assignment-flow settings.
 */

const SurveySketchStandardPricing = require("../../models/config/SurveySketchStandardPricing");
const { PRICING_KEY, ensureLegacyPricingMigrated } = require("../sketchStandardPricing.repository");
const sketchPaymentPricing = require("../sketchPaymentPricing.service");
const { BadRequestError } = require("../../utils/errors");

const PRICING_FIELDS = [
  "sketchUploadPlanAmountRupees",
  "sketchUploadDiscountRupees",
  "sketchRevisionPlanAmountRupees",
  "sketchRevisionDiscountRupees",
  "sketchBalancePlanAmountRupees",
  "sketchBalanceDiscountRupees",
];

async function getPricingSettings() {
  await ensureLegacyPricingMigrated();
  const doc = await SurveySketchStandardPricing.findOneAndUpdate(
    { key: PRICING_KEY },
    { $setOnInsert: { key: PRICING_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .select([...PRICING_FIELDS, "updatedBy", "createdAt", "updatedAt"].join(" "))
    .populate("updatedBy", "name role")
    .lean();

  const pricing = await sketchPaymentPricing.getPublicPricingBreakdown();

  return {
    sketchUploadPlanAmountRupees: doc?.sketchUploadPlanAmountRupees ?? null,
    sketchUploadDiscountRupees: doc?.sketchUploadDiscountRupees ?? null,
    sketchRevisionPlanAmountRupees: doc?.sketchRevisionPlanAmountRupees ?? null,
    sketchRevisionDiscountRupees: doc?.sketchRevisionDiscountRupees ?? null,
    sketchBalancePlanAmountRupees: doc?.sketchBalancePlanAmountRupees ?? null,
    sketchBalanceDiscountRupees: doc?.sketchBalanceDiscountRupees ?? null,
    pricing,
    updatedBy: doc?.updatedBy ?? null,
    updatedAt: doc?.updatedAt ?? null,
    createdAt: doc?.createdAt ?? null,
  };
}

async function updatePricingSettings(payload, actor) {
  await ensureLegacyPricingMigrated();
  const $set = {};
  for (const f of PRICING_FIELDS) {
    if (payload[f] !== undefined) {
      $set[f] = payload[f];
    }
  }
  if (Object.keys($set).length === 0) {
    throw new BadRequestError("At least one pricing field is required", {
      code: "EMPTY_PRICING_UPDATE",
    });
  }
  $set.updatedBy = actor?._id || null;

  await SurveySketchStandardPricing.findOneAndUpdate(
    { key: PRICING_KEY },
    { $set, $setOnInsert: { key: PRICING_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return getPricingSettings();
}

module.exports = {
  getPricingSettings,
  updatePricingSettings,
};
