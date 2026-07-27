/**
 * H-08 acceptance: business rules baseline + public API + matrix docs.
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
  getApprovedBusinessRulesPublic,
  QC_CHECKLIST_11E,
  SURVEYOR_BALANCE_FEE_RUPEES_FIXED,
} = require("../src/config/businessRulesBaseline");

const rules = getApprovedBusinessRulesPublic();
assert("fixed ₹400 balance", rules.surveyorBalanceFee.rupees === 400 && rules.surveyorBalanceFee.tiers === false);
assert("no CAD tiers", rules.cadOperatorEarnings.tiers === false);
assert("QC has 10 checks", QC_CHECKLIST_11E.length === 10 && rules.qc.checkCount === 10);
assert("government claims disallowed", rules.governmentClaims.allowed === false);
assert("fictional testimonials disallowed", rules.testimonials.fictionalAllowed === false);
assert("SURVEYOR_BALANCE_FEE_RUPEES_FIXED === 400", SURVEYOR_BALANCE_FEE_RUPEES_FIXED === 400);

assert("content matrix exists", fs.existsSync(path.join(root, "docs/CONTENT_CLAIMS_MATRIX_H08.md")));
assert("FE H-08 doc exists", fs.existsSync(path.join(root, "docs/FRONTEND_H08_PUBLIC_CLAIMS.md")));
assert("SECURITY_H08 doc exists", fs.existsSync(path.join(root, "docs/SECURITY_H08_PUBLIC_CLAIMS.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("business-rules route", /path:\s*\/api\/public\/business-rules/.test(yml));
assert("CAD_INTEREST_ENABLED env", /CAD_INTEREST_ENABLED:/.test(yml));

const interest = fs.readFileSync(path.join(root, "src/services/cadInterest.service.js"), "utf8");
assert("Coming Soon gate in cadInterest", /CAD_INTEREST_COMING_SOON/.test(interest));

const pricing = fs.readFileSync(path.join(root, "src/services/sketchPaymentPricing.service.js"), "utf8");
assert("pricing embeds businessRules", /businessRules/.test(pricing));

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Marketing site scrub + Founder signature are outside this repo.");
process.exit(failed ? 1 : 0);
