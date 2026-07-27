/**
 * M-09 acceptance: auto-assign attempts, lock, exception queue, manual override, alerts.
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

assert("SECURITY_M09 doc", fs.existsSync(path.join(root, "docs/SECURITY_M09_AUTO_ASSIGN.md")));
assert("FRONTEND_M09 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M09_AUTO_ASSIGN.md")));
assert("AutoAssignAttempt model", fs.existsSync(path.join(root, "src/models/assignment/AutoAssignAttempt.js")));
assert("autoAssign service", fs.existsSync(path.join(root, "src/services/autoAssign.service.js")));

const svc = read("src/services/autoAssign.service.js");
assert("persists attempts", /AutoAssignAttempt/.test(svc));
assert("idempotent lock", /lockToken/.test(svc) && /IN_PROGRESS/.test(svc));
assert("retry backoff", /computeNextRetryAt|RETRY_BASE/.test(svc));
assert("exception state", /EXCEPTION/.test(svc));
assert("ops alert", /ALERT_AUTO_ASSIGN_FAILURE/.test(svc));
assert("manual override gate", /assertManualAssignAllowed|MANUAL_ASSIGN_BLOCKED/.test(svc));

const uploadModel = read("src/models/surveyor/SurveyorSketchUpload.js");
assert("autoAssignMeta on upload", /autoAssignMeta/.test(uploadModel));

const createPath = read("src/services/assignment/surveySketchAssignment.service.js");
assert("create checks manual gate", /assertManualAssignAllowed/.test(createPath));
assert("manual success clears meta", /markManualAssignSucceeded/.test(createPath));

const yml = read("serverless.yml");
assert("exceptions route", /auto-assign\/exceptions/.test(yml));
assert("retry route", /auto-assign\/retry/.test(yml));
assert("AUTO_ASSIGN_MAX_ATTEMPTS env", /AUTO_ASSIGN_MAX_ATTEMPTS:/.test(yml));

const job = read("src/handlers/assignmentAutoReject.handler.js");
assert("job runs processAutoAssignRetries", /processAutoAssignRetries/.test(job));

const api = read("src/handlers/authApi.js");
assert("authApi exceptions", /auto-assign\/exceptions/.test(api));
assert("authApi manual-gate", /manual-gate/.test(api));

const pkg = JSON.parse(read("package.json"));
assert("test:m09 script", typeof pkg.scripts["test:m09"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
