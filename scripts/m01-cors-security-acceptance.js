/**
 * M-01 acceptance: no wildcard CORS; security headers present.
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

assert("SECURITY_M01 doc", fs.existsSync(path.join(root, "docs/SECURITY_M01_CORS_SECURITY_HEADERS.md")));
assert("FE M01 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M01_CORS_SECURITY_HEADERS.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("httpApi cors not bare true", !/httpApi:\s*\n\s*cors:\s*true\b/.test(yml));
assert("cors-origins.json referenced", /cors-origins\.json/.test(yml));
assert("CORS_ALLOW_ORIGINS env", /CORS_ALLOW_ORIGINS:/.test(yml));

const origins = JSON.parse(fs.readFileSync(path.join(root, "cors-origins.json"), "utf8"));
assert("cors-origins is array", Array.isArray(origins) && origins.length > 0);
assert("cors-origins has no wildcard", !origins.includes("*"));

const resp = fs.readFileSync(path.join(root, "src/utils/response.js"), "utf8");
assert("response.js has no ACAO wildcard default", !/\|\|\s*["']\*["']/.test(resp) && !/CORS_ALLOW_ORIGIN\s*\|\|/.test(resp));

const httpSec = require("../src/utils/httpSecurity");
process.env.CORS_ALLOW_ORIGINS = "https://app.example.com";
delete process.env.STAGE;
assert(
  "approved origin reflected",
  httpSec.resolveAllowOrigin({ headers: { origin: "https://app.example.com" } }) ===
    "https://app.example.com"
);
assert(
  "unapproved origin omitted",
  httpSec.resolveAllowOrigin({ headers: { origin: "https://evil.test" } }) === null
);
const headers = httpSec.securityHeaders();
assert("nosniff", headers["x-content-type-options"] === "nosniff");
assert("frame deny", headers["x-frame-options"] === "DENY");
assert("csp frame-ancestors", /frame-ancestors 'none'/.test(headers["content-security-policy"]));

const deploy = fs.readFileSync(path.join(root, "scripts/deploy-with-identity.js"), "utf8");
assert("deploy gates CORS", /assertCorsConfigReady/.test(deploy));
assert("deploy writes cors-origins.json", /cors-origins\.json/.test(deploy));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:m01 script", typeof pkg.scripts["test:m01"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: FE must still set page CSP/HSTS on the website CDN; API headers alone are not enough for HTML.");
process.exit(failed ? 1 : 0);
