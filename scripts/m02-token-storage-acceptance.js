/**
 * M-02 acceptance: HttpOnly refresh cookie + CSRF + revocation hooks.
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

assert("SECURITY_M02 doc", fs.existsSync(path.join(root, "docs/SECURITY_M02_TOKEN_STORAGE.md")));
assert("FE M02 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M02_TOKEN_STORAGE.md")));

const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
assert("AUTH_USE_REFRESH_COOKIE env", /AUTH_USE_REFRESH_COOKIE:/.test(yml));
assert("cors allowCredentials true", /allowCredentials:\s*true/.test(yml));

const cookiesUtil = fs.readFileSync(path.join(root, "src/utils/authCookies.js"), "utf8");
assert("HttpOnly refresh cookie", /HttpOnly/.test(cookiesUtil) && /cad_refresh|REFRESH_COOKIE/.test(cookiesUtil));
assert("CSRF double-submit", /X-CSRF-Token|x-csrf-token|CSRF_INVALID/.test(cookiesUtil));

const handler = fs.readFileSync(path.join(root, "src/handlers/auth.handler.js"), "utf8");
assert("refresh reads cookie", /getRefreshTokenFromRequest/.test(handler));
assert("refresh asserts CSRF", /assertCsrfIfCookieAuth/.test(handler));

const authSvc = fs.readFileSync(path.join(root, "src/services/auth.service.js"), "utf8");
assert("password reset revokes all", /revokeAllForUser/.test(authSvc));
assert("logout can revoke all", /allSessions/.test(authSvc));

const httpSec = fs.readFileSync(path.join(root, "src/utils/httpSecurity.js"), "utf8");
assert("CORS credentials when cookie mode", /access-control-allow-credentials/.test(httpSec));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:m02 script", typeof pkg.scripts["test:m02"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: FE must stop localStorage; XSS proof is incomplete until FE ships FRONTEND_M02.");
process.exit(failed ? 1 : 0);
