/**
 * Refund policy acceptance — unify Terms vs refund promise.
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
  getApprovedRefundPolicy,
  getRefundPolicyPublic,
  assertExceptionalAdminRefundAllowed,
  APPROVED_REFUND_POLICY,
} = require("../src/config/refundPolicy");

const policy = getApprovedRefundPolicy();
assert("customer not entitled", policy.customerRefundEntitled === false);
assert("no self-service refund", policy.selfServiceRefundEnabled === false);
assert("exceptional admin allowed", policy.exceptionalAdminRefundEnabled === true);
assert("terms copy non-empty", policy.termsCopyApproved.length > 40);
assert("prohibited includes money-back", policy.prohibitedCopy.some((p) => /money-back/i.test(p)));
assert("baseline frozen", APPROVED_REFUND_POLICY.baselineId === "NORTHCOT-REFUND-POLICY");

const pub = getRefundPolicyPublic();
assert("public omits admin ops detail codes optional", pub.customerRefundEntitled === false);
assert("public has termsCopyApproved", !!pub.termsCopyApproved);

try {
  assertExceptionalAdminRefundAllowed({ reasonCode: "DUPLICATE_CHARGE" });
  assert("requires note", false);
} catch (err) {
  assert("requires note", err.code === "REFUND_NOTE_REQUIRED");
}

try {
  assertExceptionalAdminRefundAllowed({ reasonCode: "FREE_REFUND", note: "x" });
  assert("rejects bad reasonCode", false);
} catch (err) {
  assert("rejects bad reasonCode", err.code === "REFUND_REASON_CODE_REQUIRED");
}

const ok = assertExceptionalAdminRefundAllowed({
  reasonCode: "GATEWAY_ERROR",
  note: "PhonePe failed capture reversed",
});
assert("accepts gateway error", ok.reasonCode === "GATEWAY_ERROR" && ok.policyVersion === policy.version);

const { getApprovedBusinessRulesPublic } = require("../src/config/businessRulesBaseline");
const rules = getApprovedBusinessRulesPublic();
assert("business-rules embeds refundPolicy", rules.refundPolicy && rules.refundPolicy.version === policy.version);
assert("business-rules customerRefundEntitled false", rules.refundPolicy.customerRefundEntitled === false);

const entitlement = fs.readFileSync(
  path.join(root, "src/services/cadDownloadEntitlement.service.js"),
  "utf8"
);
assert("admin refund uses policy assert", /assertExceptionalAdminRefundAllowed/.test(entitlement));

const validator = fs.readFileSync(path.join(root, "src/middleware/validator.js"), "utf8");
assert("validator has balanceRefundMark", /balanceRefundMark/.test(validator));

assert(
  "FE doc exists",
  fs.existsSync(path.join(root, "docs/FRONTEND_REFUND_POLICY.md"))
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
