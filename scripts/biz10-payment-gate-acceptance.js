/**
 * BIZ-10 acceptance: payment gate + terminal APPROVED/REJECTED review.
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

const gateSrc = fs.readFileSync(path.join(root, "src/services/sketchPaymentGate.service.js"), "utf8");
assert("payment gate module exists", /assertSketchBookingPaymentAllowsWorkflow/.test(gateSrc));
assert("blocks PAYMENT_PENDING", /SKETCH_PAYMENT_PENDING/.test(gateSrc));
assert("blocks incomplete booking", /SKETCH_PAYMENT_INCOMPLETE/.test(gateSrc));

const assignSrc = fs.readFileSync(
  path.join(root, "src/services/assignment/surveySketchAssignment.service.js"),
  "utf8"
);
assert("assignment create uses payment gate", /assertSketchBookingPaymentAllowsWorkflow/.test(assignSrc));
assert("assignment update uses payment gate", /assignment_update/.test(assignSrc));
assert("pullback uses payment gate", /pullback_reassign/.test(assignSrc));
assert("CAD deliver uses payment gate", /cad_deliver/.test(assignSrc));

const autoSrc = fs.readFileSync(path.join(root, "src/services/autoAssign.service.js"), "utf8");
assert("auto-assign uses payment gate", /assertSketchBookingPaymentAllowsWorkflow/.test(autoSrc));

const uploadSrc = fs.readFileSync(path.join(root, "src/services/surveyorSketchUpload.service.js"), "utf8");
assert("terminal review writer exists", /reviewSketchTerminal/.test(uploadSrc));
assert("writes APPROVED", /SURVEY_SKETCH_STATUS\.APPROVED/.test(uploadSrc) && /reviewedBy/.test(uploadSrc));
assert("writes REJECTED", /SURVEY_SKETCH_STATUS\.REJECTED/.test(uploadSrc));

const handler = fs.readFileSync(path.join(root, "src/handlers/auth.handler.js"), "utf8");
assert("admin review handler", /adminReviewSketchTerminal/.test(handler));

const api = fs.readFileSync(path.join(root, "src/handlers/authApi.js"), "utf8");
assert("review route wired", /sketch-uploads\/\{uploadId\}\/review/.test(api));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("serverless review path", /path:\s*\/api\/admin\/sketch-uploads\/\{uploadId\}\/review/.test(yml));

assert(
  "FE doc exists",
  fs.existsSync(path.join(root, "docs/FRONTEND_BIZ10_PAYMENT_GATE_TERMINAL_REVIEW.md"))
);

const {
  assertSketchBookingPaymentAllowsWorkflow,
} = require("../src/services/sketchPaymentGate.service");
const { SURVEY_SKETCH_STATUS } = require("../src/config/constants");
try {
  assertSketchBookingPaymentAllowsWorkflow({
    status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
    sketchPayment: { status: "PENDING", amountPaise: 10000 },
  });
  assert("runtime blocks PAYMENT_PENDING", false);
} catch (err) {
  assert("runtime blocks PAYMENT_PENDING", err.code === "SKETCH_PAYMENT_PENDING");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
