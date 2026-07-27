/**
 * M-06 acceptance: login a11y is FE-owned; docs present.
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

assert("SECURITY_M06 doc", fs.existsSync(path.join(root, "docs/SECURITY_M06_LOGIN_A11Y.md")));
assert("FE M06 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M06_LOGIN_A11Y.md")));

const fe = fs.readFileSync(path.join(root, "docs/FRONTEND_M06_LOGIN_A11Y.md"), "utf8");
assert("label for / id guidance", /label for|for=/.test(fe));
assert("autocomplete guidance", /autocomplete/.test(fe));
assert("WCAG 2.2 AA", /WCAG 2\.2 AA/.test(fe));
assert("axe / Playwright", /axe|Playwright/i.test(fe));
assert("Kannada review", /Kannada/i.test(fe));
assert("error summary / aria", /aria-describedby|error summary|role="alert"/i.test(fe));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:m06 script", typeof pkg.scripts["test:m06"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: axe/Playwright evidence must be produced in the Frontend repo.");
process.exit(failed ? 1 : 0);
