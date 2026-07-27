/**
 * H-11 acceptance: fixed ₹400 CAD payout; no 20% default; fail-closed config.
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

assert("SECURITY_H11 doc", fs.existsSync(path.join(root, "docs/SECURITY_H11_CAD_PAYOUT.md")));
assert("FE H-11 doc", fs.existsSync(path.join(root, "docs/FRONTEND_H11_CAD_PAYOUT.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("no CAD_PAYOUT_PERCENT default 20", !/CAD_PAYOUT_PERCENT:.*'20'/.test(yml));
assert("CAD_OPERATOR_PAYOUT_PAISE default 40000", /CAD_OPERATOR_PAYOUT_PAISE:.*'40000'/.test(yml));
assert("CAD_PAYOUT_RULE_VERSION set", /CAD_PAYOUT_RULE_VERSION:/.test(yml));

const svc = fs.readFileSync(path.join(root, "src/services/cadPayoutPricing.service.js"), "utf8");
assert("no silent return 20 percent", !/return 20;/.test(svc));
assert("FIXED rule version constant", /CAD_PAYOUT_V1_FIXED_400/.test(svc));

const ledger = fs.readFileSync(path.join(root, "src/models/cad/CadWalletLedger.js"), "utf8");
assert("ledger stores pricingRuleVersion", /pricingRuleVersion/.test(ledger));
assert("ledger stores gross/booking/balance/payout", /grossPricePaise/.test(ledger) && /bookingPaise/.test(ledger));

const deploy = fs.readFileSync(path.join(root, "scripts/deploy-with-identity.js"), "utf8");
assert("deploy gates on assertCadPayoutRuleReady", /assertCadPayoutRuleReady/.test(deploy));

const {
  getApprovedCadPayoutRule,
  computeCadPayoutSettlement,
} = require("../src/services/cadPayoutPricing.service");
const { CAD_WALLET_ENTRY_KIND } = require("../src/config/constants");
const { getApprovedBusinessRulesPublic } = require("../src/config/businessRulesBaseline");

const rule = getApprovedCadPayoutRule();
assert("rule payout ₹400", rule.operatorPayoutPaise === 40000);
assert("rule gross ₹500", rule.grossPricePaise === 50000);
assert(
  "not 20% of 500",
  rule.operatorPayoutPaise !== Math.round((rule.grossPricePaise * 20) / 100)
);

const { amountPaise } = computeCadPayoutSettlement({
  kind: CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY,
  sourcePaidPaise: 50000,
});
assert("settlement amount ₹400", amountPaise === 40000);

const pub = getApprovedBusinessRulesPublic();
assert("public API FIXED model", pub.cadOperatorEarnings.model === "FIXED");
assert("public API payoutRupees 400", pub.cadOperatorEarnings.payoutRupees === 400);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:h11 script", typeof pkg.scripts["test:h11"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Production evidence of live env values is an ops checklist item outside CI.");
process.exit(failed ? 1 : 0);
