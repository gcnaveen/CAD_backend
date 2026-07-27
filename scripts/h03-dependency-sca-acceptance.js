/**
 * H-03 acceptance: production SCA has zero Critical and zero unaccepted High.
 * Dev-only findings must appear in docs/SECURITY_H03_DEPENDENCY_EXCEPTIONS.json
 * with owner + expiry still in the future.
 *
 * Run: node scripts/h03-dependency-sca-acceptance.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const exceptionsPath = path.join(root, "docs", "SECURITY_H03_DEPENDENCY_EXCEPTIONS.json");

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

function runAudit(omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  try {
    const out = execSync(`npm ${args.join(" ")}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(out || "{}");
  } catch (err) {
    // npm audit exits non-zero when findings exist; stdout still has JSON
    const out = err.stdout || "";
    try {
      return JSON.parse(out);
    } catch {
      throw err;
    }
  }
}

assert("package-lock.json present (pinned)", fs.existsSync(path.join(root, "package-lock.json")));
assert("exceptions register present", fs.existsSync(exceptionsPath));

const exceptionsDoc = JSON.parse(fs.readFileSync(exceptionsPath, "utf8"));
const now = new Date();
const accepted = new Map();
for (const ex of exceptionsDoc.exceptions || []) {
  assert(
    `exception ${ex.id} has CVE/advisory`,
    Boolean(ex.cveOrAdvisory && String(ex.cveOrAdvisory).length > 3)
  );
  assert(`exception ${ex.id} has owner`, Boolean(ex.owner));
  assert(`exception ${ex.id} has compensatingControl`, Boolean(ex.compensatingControl));
  assert(`exception ${ex.id} has exploitability`, Boolean(ex.exploitability));
  const expiry = new Date(ex.expiry);
  assert(`exception ${ex.id} expiry valid date`, !Number.isNaN(expiry.getTime()), ex.expiry);
  assert(`exception ${ex.id} not expired`, expiry > now, ex.expiry);
  for (const pkg of ex.packages || []) {
    accepted.set(`${pkg}|${ex.severity}`, ex);
  }
}

const prod = runAudit(true);
const prodMeta = prod.metadata?.vulnerabilities || {};
assert("prod critical === 0", (prodMeta.critical || 0) === 0, JSON.stringify(prodMeta));
assert("prod high === 0", (prodMeta.high || 0) === 0, JSON.stringify(prodMeta));

const full = runAudit(false);
const vulns = full.vulnerabilities || {};
for (const [name, info] of Object.entries(vulns)) {
  if (info.severity !== "critical" && info.severity !== "high") continue;
  const key = `${name}|${info.severity}`;
  assert(
    `accepted High/Critical: ${name} (${info.severity})`,
    accepted.has(key),
    "add to SECURITY_H03_DEPENDENCY_EXCEPTIONS.json"
  );
}

const sbomPath = path.join(root, "docs", "sbom", "sbom-cyclonedx.json");
assert("SBOM file exists (run npm run sbom)", fs.existsSync(sbomPath));
if (fs.existsSync(sbomPath)) {
  const bom = JSON.parse(fs.readFileSync(sbomPath, "utf8"));
  assert("SBOM has components", Array.isArray(bom.components) && bom.components.length > 0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert("npm overrides present for transitive pins", Boolean(pkg.overrides && Object.keys(pkg.overrides).length));
assert("no xlsx in backend runtime deps", !pkg.dependencies?.xlsx);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
