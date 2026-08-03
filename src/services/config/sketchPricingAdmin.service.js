/**
 * Admin sketch pricing: discounts only (BIZ-09 / NEW-02 / NEW-04).
 * Plan amounts are server-owned via sketchOrderPricing — admin cannot set ₹1 plans.
 */

const SurveySketchStandardPricing = require("../../models/config/SurveySketchStandardPricing");
const { PRICING_KEY, ensureLegacyPricingMigrated } = require("../sketchStandardPricing.repository");
const sketchPaymentPricing = require("../sketchPaymentPricing.service");
const { getApprovedSketchOrderPricing } = require("../../config/sketchOrderPricing");
const { BadRequestError } = require("../../utils/errors");

const DISCOUNT_FIELDS = [
  "sketchUploadDiscountRupees",
  "sketchRevisionDiscountRupees",
  "sketchBalanceDiscountRupees",
  "sketchSuperimposeDiscountRupees",
];

const PLAN_FIELDS = [
  "sketchUploadPlanAmountRupees",
  "sketchRevisionPlanAmountRupees",
  "sketchBalancePlanAmountRupees",
  "sketchSuperimposePlanAmountRupees",
];

const PLAN_TO_CONTRACT = {
  sketchUploadPlanAmountRupees: "bookingRupees",
  sketchRevisionPlanAmountRupees: "revisionRupees",
  sketchBalancePlanAmountRupees: "balanceRupees",
  sketchSuperimposePlanAmountRupees: "superimposeRupees",
};

function assertNonNegNumberOrNull(field, value) {
  if (value === null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestError(`${field} must be a non-negative number or null`, {
      code: "PRICING_FIELD_INVALID",
      errors: [{ field, message: "Invalid amount" }],
    });
  }
  return n;
}

async function getPricingSettings() {
  await ensureLegacyPricingMigrated();
  const doc = await SurveySketchStandardPricing.findOneAndUpdate(
    { key: PRICING_KEY },
    { $setOnInsert: { key: PRICING_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .select([...DISCOUNT_FIELDS, ...PLAN_FIELDS, "updatedBy", "createdAt", "updatedAt"].join(" "))
    .populate("updatedBy", "name role")
    .lean();

  const contract = getApprovedSketchOrderPricing();
  const pricing = await sketchPaymentPricing.getPublicPricingBreakdown();

  // Always surface contract plan amounts (ignore stale Mongo ₹1 plans for display).
  return {
    sketchUploadPlanAmountRupees: contract.bookingRupees,
    sketchUploadDiscountRupees: doc?.sketchUploadDiscountRupees ?? null,
    sketchRevisionPlanAmountRupees: contract.revisionRupees,
    sketchRevisionDiscountRupees: doc?.sketchRevisionDiscountRupees ?? null,
    sketchBalancePlanAmountRupees: contract.balanceRupees,
    sketchBalanceDiscountRupees: doc?.sketchBalanceDiscountRupees ?? null,
    sketchSuperimposePlanAmountRupees: contract.superimposeRupees,
    sketchSuperimposeDiscountRupees: doc?.sketchSuperimposeDiscountRupees ?? null,
    pricingContract: pricing.pricingContract,
    pricing,
    updatedBy: doc?.updatedBy ?? null,
    updatedAt: doc?.updatedAt ?? null,
    createdAt: doc?.createdAt ?? null,
  };
}

async function updatePricingSettings(payload, actor) {
  await ensureLegacyPricingMigrated();
  const contract = getApprovedSketchOrderPricing();
  const $set = {};

  for (const f of PLAN_FIELDS) {
    if (payload[f] === undefined) continue;
    const expected = contract[PLAN_TO_CONTRACT[f]];
    if (payload[f] === null) {
      // Clearing stored plan is fine — checkout ignores Mongo plans anyway.
      $set[f] = null;
      continue;
    }
    const n = assertNonNegNumberOrNull(f, payload[f]);
    if (n !== expected) {
      throw new BadRequestError(
        `${f} is server-owned (contract ${contract.version}). Expected ₹${expected} or null; got ₹${n}. Change discounts only, or bump finance contract version.`,
        {
          code: "SKETCH_PLAN_LOCKED_TO_CONTRACT",
          errors: [{ field: f, message: `Must be ${expected} or null` }],
        }
      );
    }
    $set[f] = n;
  }

  for (const f of DISCOUNT_FIELDS) {
    if (payload[f] === undefined) continue;
    $set[f] = assertNonNegNumberOrNull(f, payload[f]);
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
