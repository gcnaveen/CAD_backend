/**
 * BIZ-09 / NEW-02 / NEW-04: single server-owned sketch pricing contract.
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let passed = 0;
let failed = 0;

function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const {
  getApprovedSketchOrderPricing,
  assertSketchOrderPricingReady,
  APPROVED_SKETCH_ORDER_PRICING,
} = require("../src/config/sketchOrderPricing");

const rule = getApprovedSketchOrderPricing();
assert("gross ₹500", rule.grossPaise === 50000 && rule.grossRupees === 500);
assert("booking ₹100", rule.bookingPaise === 10000);
assert("balance ₹400", rule.balancePaise === 40000);
assert("booking + balance = gross", rule.bookingPaise + rule.balancePaise === rule.grossPaise);
assert("superimpose ₹200 default", rule.superimposePaise === 20000);
assert("phase refs include BIZ-09", rule.phaseRefs.includes("BIZ-09"));
assert("assertSketchOrderPricingReady returns rule", assertSketchOrderPricingReady().version === rule.version);
assert("baseline frozen", APPROVED_SKETCH_ORDER_PRICING.baselineId === "NORTHCOT-SKETCH-PRICING-BIZ09");

const pricingSrc = fs.readFileSync(path.join(root, "src/services/sketchPaymentPricing.service.js"), "utf8");
assert("checkout uses contractPlanRupees", /contractPlanRupees/.test(pricingSrc));
assert("public exposes pricingContract", /pricingContract/.test(pricingSrc));
assert("ignores admin plan replacement", /cannot replace plan/i.test(pricingSrc) || /discounts only/i.test(pricingSrc));

const adminSrc = fs.readFileSync(path.join(root, "src/services/config/sketchPricingAdmin.service.js"), "utf8");
assert("admin locks plans to contract", /SKETCH_PLAN_LOCKED_TO_CONTRACT/.test(adminSrc));

const phonePe = fs.readFileSync(path.join(root, "src/services/phonePeSketchPayment.service.js"), "utf8");
assert("PhonePe getters use sketch contract", /getApprovedSketchOrderPricing/.test(phonePe));

const baseline = fs.readFileSync(path.join(root, "src/config/businessRulesBaseline.js"), "utf8");
assert("business-rules embeds sketchOrderPricing", /sketchOrderPricing/.test(baseline));

const deploy = fs.readFileSync(path.join(root, "scripts/deploy-with-identity.js"), "utf8");
assert("deploy gates on assertSketchOrderPricingReady", /assertSketchOrderPricingReady/.test(deploy));

assert(
  "FE contract doc exists",
  fs.existsSync(path.join(root, "docs/FRONTEND_SKETCH_PRICING_CONTRACT.md"))
);

const { getApprovedBusinessRulesPublic } = require("../src/config/businessRulesBaseline");
const publicRules = getApprovedBusinessRulesPublic();
assert(
  "public business-rules has sketchOrderPricing 500",
  publicRules.sketchOrderPricing && publicRules.sketchOrderPricing.grossRupees === 500
);
assert("public balance fee ₹400", publicRules.surveyorBalanceFee.rupees === 400);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
