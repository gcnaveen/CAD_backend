/**
 * M-05 acceptance: performance finding is FE-owned; docs present.
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

assert("SECURITY_M05 doc", fs.existsSync(path.join(root, "docs/SECURITY_M05_PERFORMANCE.md")));
assert("FE M05 doc", fs.existsSync(path.join(root, "docs/FRONTEND_M05_PERFORMANCE_BUDGET.md")));

const fe = fs.readFileSync(path.join(root, "docs/FRONTEND_M05_PERFORMANCE_BUDGET.md"), "utf8");
assert("LCP budget documented", /LCP.*2\.5/.test(fe));
assert("INP budget documented", /INP.*200/.test(fe));
assert("CLS budget documented", /CLS.*0\.1/.test(fe));
assert("JS gzip budget documented", /250\s*KB/.test(fe));
assert("route-split / lazy guidance", /lazy|Route-split|route-split/i.test(fe));
assert("video poster / mobile variants", /poster|WebM|webm/i.test(fe));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("test:m05 script", typeof pkg.scripts["test:m05"] === "string");

console.log(`\n${passed} passed, ${failed} failed`);
console.log("NOTE: Measured Lighthouse/mobile budgets must be proven in the Frontend CI/repo.");
process.exit(failed ? 1 : 0);
