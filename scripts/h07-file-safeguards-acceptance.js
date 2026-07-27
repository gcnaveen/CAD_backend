/**
 * H-07 acceptance scaffolding.
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

assert("SECURITY_H07 doc", fs.existsSync(path.join(root, "docs/SECURITY_H07_FILE_SAFEGUARDS.md")));
assert("S3 hardening doc", fs.existsSync(path.join(root, "docs/S3_BUCKET_HARDENING.md")));
assert("DPDP doc", fs.existsSync(path.join(root, "docs/DPDP_NOTICE_CONSENT.md")));
assert("FE H-07 doc", fs.existsSync(path.join(root, "docs/FRONTEND_H07_FILE_SAFEGUARDS.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("upload confirm route", /path:\s*\/api\/upload\/confirm/.test(yml));
assert("UPLOAD_REQUIRE_AUTH env", /UPLOAD_REQUIRE_AUTH:/.test(yml));

assert("FileAccessEvent model", fs.existsSync(path.join(root, "src/models/security/FileAccessEvent.js")));
assert("fileSecurity service", fs.existsSync(path.join(root, "src/services/fileSecurity.service.js")));

const uploadApi = fs.readFileSync(path.join(root, "src/handlers/uploadApi.js"), "utf8");
assert("confirm wired in uploadApi", /upload\/confirm/.test(uploadApi));

const s3 = fs.readFileSync(path.join(root, "src/utils/s3.js"), "utf8");
assert("SSE on put", /ServerSideEncryption:\s*"AES256"/.test(s3));
assert("quarantineObject exported", /quarantineObject/.test(s3));

const { validateFileHeader } = require("../src/services/fileSecurity.service");
assert(
  "malicious exe as dwg fails",
  validateFileHeader(Buffer.from("MZevil"), { fileName: "x.dwg", contentType: "application/acad" }).ok === false
);
assert(
  "png magic ok",
  validateFileHeader(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
    fileName: "a.png",
    contentType: "image/png",
  }).ok === true
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:h07 script", typeof pkg.scripts["test:h07"] === "string");
assert("retention:purge script", typeof pkg.scripts["retention:purge"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Ops must still prove S3 Block Public Access + ClamAV + restore drill outside CI.");
process.exit(failed ? 1 : 0);
