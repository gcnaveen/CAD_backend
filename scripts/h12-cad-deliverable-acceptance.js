/**
 * H-12 acceptance: CAD deliverable DWG/DXF path + contract.
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

assert("SECURITY_H12 doc", fs.existsSync(path.join(root, "docs/SECURITY_H12_CAD_DELIVERABLE.md")));
assert("FE H-12 doc", fs.existsSync(path.join(root, "docs/FRONTEND_H12_CAD_DELIVERABLE.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("cad-deliverable route", /path:\s*\/api\/upload\/cad-deliverable/.test(yml));
assert("multipart start route", /cad-deliverable\/multipart\/start/.test(yml));
assert("CAD_SOURCE_MAX_BYTES env", /CAD_SOURCE_MAX_BYTES:/.test(yml));

const s3 = fs.readFileSync(path.join(root, "src/utils/s3.js"), "utf8");
assert("cad-deliverables folder type", /cad-deliverables/.test(s3));
assert("multipart helpers", /createMultipartUpload/.test(s3) && /headObject/.test(s3));

const uploadApi = fs.readFileSync(path.join(root, "src/handlers/uploadApi.js"), "utf8");
assert("uploadApi wires cad-deliverable", /upload\/cad-deliverable/.test(uploadApi));

const fileSec = require("../src/services/fileSecurity.service");
assert("DWG AC1032 ok", fileSec.isDwgHeader(Buffer.from("AC1032xxxx")) === true);
assert(
  "DXF SECTION ok",
  fileSec.isDxfHeader(Buffer.from("0\nSECTION\n2\nHEADER\n")) === true
);
assert(
  "spoofed DXF fails",
  fileSec.validateFileHeader(Buffer.from("%PDF"), { fileName: "x.dxf", contentType: "application/dxf" })
    .ok === false
);
assert(
  "spoofed DWG fails",
  fileSec.validateFileHeader(Buffer.from("MZevil"), { fileName: "x.dwg", contentType: "application/acad" })
    .ok === false
);

const assign = fs.readFileSync(
  path.join(root, "src/services/assignment/surveySketchAssignment.service.js"),
  "utf8"
);
assert("deliver enforces contract", /assertCadDeliverableBundle/.test(assign));

const schema = fs.readFileSync(path.join(root, "src/models/surveyor/SurveyorSketchUpload.js"), "utf8");
assert("document role/sha256/confirmed fields", /sha256/.test(schema) && /confirmed/.test(schema));

const download = fs.readFileSync(
  path.join(root, "src/services/cadDownloadEntitlement.service.js"),
  "utf8"
);
assert("authorized download gate still present", /getCadDownloadForSurveyor/.test(download));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:h12 script", typeof pkg.scripts["test:h12"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: QA should still upload real DWG/DXF samples against a deployed stage.");
process.exit(failed ? 1 : 0);
