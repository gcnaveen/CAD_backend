/**
 * H-09 acceptance: handover binder present (ownership transfer is human/ops).
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const docs = path.join(root, "docs");
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

const required = [
  "SECURITY_H09_OWNERSHIP_HANDOVER.md",
  "HANDOVER_CHECKLIST_H09.md",
  "ACCESS_INVENTORY_H09.md",
  "WARRANTY_AND_EXIT_SUPPORT_H09.md",
  "RUNBOOK_SOURCE_AND_DEPLOY.md",
  "RUNBOOK_BACKUP_RESTORE.md",
  "RUNBOOK_MONITORING_INCIDENT.md",
  "RUNBOOK_PAYMENTS_RECONCILE.md",
];

for (const f of required) {
  assert(`doc ${f}`, fs.existsSync(path.join(docs, f)));
}

const checklist = fs.readFileSync(path.join(docs, "HANDOVER_CHECKLIST_H09.md"), "utf8");
assert("checklist mentions GitHub org transfer", /North-cot|organization/i.test(checklist));
assert("checklist mentions MFA", /MFA/i.test(checklist));
assert("checklist has deploy/restore/DNS/payment/vendor revoke", 
  /deploy/i.test(checklist) && /restore/i.test(checklist) && /DNS/i.test(checklist) && /[Pp]ayment|[Pp]honePe/.test(checklist) && /[Vv]endor/.test(checklist));
assert("checklist has signature block", /Founder/i.test(checklist) && /Signature/i.test(checklist));

const warranty = fs.readFileSync(path.join(docs, "WARRANTY_AND_EXIT_SUPPORT_H09.md"), "utf8");
assert("warranty has revoke steps", /Remove vendor|Disable vendor|rotate/i.test(warranty));

const inventory = fs.readFileSync(path.join(docs, "ACCESS_INVENTORY_H09.md"), "utf8");
assert("inventory has billing table", /Billing|Renewal/i.test(inventory));
assert("inventory has least privilege", /Least-privilege|least privilege/i.test(inventory));

assert("DEPLOY.md exists", fs.existsSync(path.join(root, "DEPLOY.md")));
assert("VIEW_LOGS.md exists", fs.existsSync(path.join(root, "VIEW_LOGS.md")));
assert("swagger.yaml exists", fs.existsSync(path.join(root, "swagger.yaml")));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:h09 script", typeof pkg.scripts["test:h09"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Org transfer, MFA, and live restore drills are Founder/vendor actions — not automatable here.");
process.exit(failed ? 1 : 0);
