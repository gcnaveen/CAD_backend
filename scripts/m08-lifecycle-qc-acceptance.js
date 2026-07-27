/**
 * M-08 acceptance: one signed lifecycle/QC spec drives code, API, FE, SOP.
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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

assert("SECURITY_M08 doc", fs.existsSync(path.join(root, "docs/SECURITY_M08_LIFECYCLE_QC.md")));
assert("FRONTEND_M08 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M08_LIFECYCLE_QC.md")));
assert("SOP_M08 doc", fs.existsSync(path.join(root, "docs/SOP_LIFECYCLE_QC_M08.md")));
assert("LIFECYCLE_QC_SPEC JSON", fs.existsSync(path.join(root, "docs/LIFECYCLE_QC_SPEC_M08.json")));

const {
  getLifecycleQcPublicSpec,
  assertSketchStatusTransition,
  QC_CHECKLIST_11E,
  ORDER_TYPES,
  QC_MATRIX,
} = require("../src/config/lifecycleQcSpec");
const { getApprovedBusinessRulesPublic } = require("../src/config/businessRulesBaseline");

const spec = getLifecycleQcPublicSpec();
const json = JSON.parse(read("docs/LIFECYCLE_QC_SPEC_M08.json"));

assert("spec id", spec.specId === "NORTHCOT-LIFECYCLE-QC-M08");
assert("JSON matches module version", json.version === spec.version && json.specId === spec.specId);
assert("7 sketch statuses", spec.sketchStatuses.length === 7);
assert("10 QC checks", QC_CHECKLIST_11E.length === 10 && spec.qc.checkCount === 10);
assert("Express no QC bypass", QC_MATRIX.byOrderType[ORDER_TYPES.EXPRESS_11E].expressBypassQc === false);
assert("prohibited 6-point copy", spec.qc.prohibitedCopy.some((c) => /6-point/i.test(c)));
assert("approved every-drawing QC copy", spec.qc.siteCopyApproved.length >= 1);

let rejected = false;
try {
  assertSketchStatusTransition("APPROVED", "PENDING");
} catch (e) {
  rejected = e.code === "INVALID_SKETCH_TRANSITION";
}
assert("invalid transition rejected", rejected);

const rules = getApprovedBusinessRulesPublic();
assert("business-rules embeds lifecycleMachine", rules.lifecycleMachine && rules.lifecycleMachine.labels);
assert("H-08 qc from same checklist", rules.qc.checkCount === 10);

const assignment = read("src/services/assignment/surveySketchAssignment.service.js");
assert("assignment uses applySketchStatus", /applySketchStatus/.test(assignment));
assert("assignment asserts QC on deliver", /assertQcRequiredForRelease/.test(assignment));

const handler = read("src/handlers/auth.handler.js");
assert("admin statuses return catalog", /getLifecycleQcPublicSpec/.test(handler));

const pkg = JSON.parse(read("package.json"));
assert("test:m08 script", typeof pkg.scripts["test:m08"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
