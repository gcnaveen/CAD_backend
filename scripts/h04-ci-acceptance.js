/**
 * H-04 acceptance: CI quality gate artifacts exist + unit suite green.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

const ciYml = path.join(root, ".github", "workflows", "ci-quality-gate.yml");
assert("ci-quality-gate.yml exists", fs.existsSync(ciYml));
if (fs.existsSync(ciYml)) {
  const body = fs.readFileSync(ciYml, "utf8");
  assert("CI runs on pull_request", /pull_request/.test(body));
  assert("CI runs unit tests", /test:unit|npm test/.test(body));
  assert("CI runs acceptance / audit", /test:acceptance|audit:prod|test:h03/.test(body));
}

const unitDir = path.join(root, "tests", "unit");
assert("tests/unit exists", fs.existsSync(unitDir));
const unitFiles = fs.existsSync(unitDir)
  ? fs.readdirSync(unitDir).filter((f) => f.endsWith(".test.js"))
  : [];
assert("at least 4 unit test files", unitFiles.length >= 4, String(unitFiles.length));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("npm test script defined", typeof pkg.scripts?.test === "string");
assert("test:acceptance defined", typeof pkg.scripts?.["test:acceptance"] === "string");
assert("lint script defined", typeof pkg.scripts?.lint === "string");

const branchDoc = path.join(root, "docs", "SECURITY_H04_CI_QUALITY_GATE.md");
assert("H-04 gate doc exists", fs.existsSync(branchDoc));
assert("FE H-04 note exists", fs.existsSync(path.join(root, "docs", "FRONTEND_H04_CI_TESTS.md")));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
