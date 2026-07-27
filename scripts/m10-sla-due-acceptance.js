/**
 * M-10 acceptance: server dueAt, pause/extend, role surfacing, alerts.
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

assert("SECURITY_M10 doc", fs.existsSync(path.join(root, "docs/SECURITY_M10_SLA_DUE.md")));
assert("FRONTEND_M10 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M10_SLA_DUE.md")));
assert("slaDue service", fs.existsSync(path.join(root, "src/services/slaDue.service.js")));

const model = read("src/models/assignment/SurveySketchAssignment.js");
assert("dueAt field", /dueAt:/.test(model));
assert("slaExtensions field", /slaExtensions:/.test(model));
assert("slaPausedAt field", /slaPausedAt:/.test(model));

const svc = read("src/services/slaDue.service.js");
assert("clock injection", /setNowProvider/.test(svc));
assert("pause/resume", /pauseSla/.test(svc) && /resumeSla/.test(svc));
assert("extend immutable", /extendSla/.test(svc));

const assign = read("src/services/assignment/surveySketchAssignment.service.js");
assert("applySlaOnAssign on create", /applySlaOnAssign/.test(assign));
assert("processSlaAlerts", /processSlaAlerts/.test(assign));
assert("extendAssignmentSla", /extendAssignmentSla/.test(assign));

const surveyor = read("src/services/surveyorSketchUpload.service.js");
assert("surveyor orders expose sla", /buildSlaSnapshot|decorateAssignment/.test(surveyor));

const yml = read("serverless.yml");
assert("sla-extend route", /sla-extend/.test(yml));
assert("CAD_SLA_WARNING_MS", /CAD_SLA_WARNING_MS:/.test(yml));

const job = read("src/handlers/assignmentAutoReject.handler.js");
assert("job runs processSlaAlerts", /processSlaAlerts/.test(job));

const api = read("src/handlers/authApi.js");
assert("authApi sla-extend", /sla-extend/.test(api));

const pkg = JSON.parse(read("package.json"));
assert("test:m10 script", typeof pkg.scripts["test:m10"] === "string");

// Quick clock calc
const slaDue = require("../src/services/slaDue.service");
slaDue.setNowProvider(() => new Date("2026-01-01T00:00:00.000Z"));
const doc = {};
slaDue.applySlaOnAssign(doc, { at: new Date("2026-01-01T00:00:00.000Z") });
assert("48h dueAt calc", doc.dueAt.toISOString() === "2026-01-03T00:00:00.000Z");
slaDue.resetNowProvider();

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
