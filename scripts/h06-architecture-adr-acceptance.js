/**
 * H-06 acceptance: ADR + unsafe defaults removed + inventory/runbook.
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

const adr = path.join(root, "docs", "ADR-0001-AS_BUILT_ARCHITECTURE.md");
assert("ADR-0001 exists", fs.existsSync(adr));
if (fs.existsSync(adr)) {
  const body = fs.readFileSync(adr, "utf8");
  assert("ADR adopts Lambda/Mongo/PhonePe", /Lambda/i.test(body) && /MongoDB/i.test(body) && /PhonePe/i.test(body));
  assert("ADR has signature block", /Signature/i.test(body) && /Founder/i.test(body));
  assert("ADR covers backup", /Backup/i.test(body));
  assert("ADR covers indexes", /Indexes/i.test(body));
  assert("ADR covers cost", /[Cc]ost/i.test(body));
  assert("ADR has diagram", /mermaid/i.test(body));
}

assert("environment inventory exists", fs.existsSync(path.join(root, "docs/ARCHITECTURE_ENVIRONMENT_INVENTORY.md")));
assert("runbook exists", fs.existsSync(path.join(root, "docs/RUNBOOK_OPERATIONS.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("no hardcoded ccaddrawing bucket", !/ccaddrawing/.test(yml));
assert("S3_BUCKET from env only", /s3BucketName:\s*\$\{env:S3_BUCKET\}/.test(yml));
assert("stage not silently defaulted to dev in provider", !/stage:\s*\$\{opt:stage,\s*'dev'\}/.test(yml));

const s3src = fs.readFileSync(path.join(root, "src/utils/s3.js"), "utf8");
assert("s3.js has no hardcoded bucket fallback string", !/cad-backend-api-dev-deployments/.test(s3src));
assert("s3.js getBucket throws if unset", /S3_BUCKET is not configured/.test(s3src));

const deploy = fs.readFileSync(path.join(root, "scripts/deploy-with-identity.js"), "utf8");
assert("deploy requires --stage", /--stage is required/.test(deploy));
assert("deploy requires S3_BUCKET", /S3_BUCKET/.test(deploy) && /required for deploy/.test(deploy));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("arch:indexes script", typeof pkg.scripts["arch:indexes"] === "string");
assert("test:h06 script", typeof pkg.scripts["test:h06"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Wet-ink / DocuSign on ADR-0001 is an owner action outside this repo.");
process.exit(failed ? 1 : 0);
