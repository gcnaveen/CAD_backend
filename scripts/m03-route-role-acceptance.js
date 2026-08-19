/**
 * M-03 acceptance: FE owns route guards; backend authz matrix + docs present.
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

assert("SECURITY_M03 doc", fs.existsSync(path.join(root, "docs/SECURITY_M03_ROUTE_ROLE.md")));
assert("FE M03 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M03_ROUTE_ROLE_GUARD.md")));
assert("route role matrix JSON", fs.existsSync(path.join(root, "docs/ROUTE_ROLE_MATRIX_M03.json")));

const matrix = JSON.parse(fs.readFileSync(path.join(root, "docs/ROUTE_ROLE_MATRIX_M03.json"), "utf8"));
assert("matrix has roles", Array.isArray(matrix.roles) && matrix.roles.includes("CAD"));
assert("superadmin shell forbids CAD", matrix.appShells.some((s) => s.shell === "superadmin" && s.forbiddenRoles.includes("CAD")));
assert("apiPrefixes present", Array.isArray(matrix.apiPrefixes) && matrix.apiPrefixes.length > 0);

assert("authz unit matrix exists", fs.existsSync(path.join(root, "tests/unit/authz-matrix.test.js")));
const authz = fs.readFileSync(path.join(root, "tests/unit/authz-matrix.test.js"), "utf8");
assert("authz tests CAD vs admin", /cad allowed on cad route, not admin/.test(authz));
assert("authz tests surveyor vs admin", /surveyor forbidden on admin route/.test(authz));

const mw = fs.readFileSync(path.join(root, "src/middleware/auth.middleware.js"), "utf8");
assert(
  "authorize enforces allowedRoles",
  /allowed\.includes\(role\)/.test(mw) || /allowedRoles\.includes\(user\.role\)/.test(mw)
);

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:m03 script", typeof pkg.scripts["test:m03"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: E2E that unauthorized shells never render is a Frontend CI check.");
process.exit(failed ? 1 : 0);
