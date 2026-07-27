/**
 * Generate a CycloneDX-lite SBOM (JSON) from package-lock.json.
 * Classifies each direct dependency as runtime | development.
 *
 * Usage: node scripts/generate-sbom.js [outPath]
 * Default out: docs/sbom/sbom-cyclonedx.json
 */

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lockPath = path.join(root, "package-lock.json");
if (!fs.existsSync(lockPath)) {
  console.error("package-lock.json required (pin lockfiles)");
  process.exit(1);
}
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));

const outPath =
  process.argv[2] || path.join(root, "docs", "sbom", "sbom-cyclonedx.json");

function resolvedVersion(name) {
  const key = `node_modules/${name}`;
  const entry = lock.packages?.[key];
  return entry?.version || null;
}

function component(name, version, scope) {
  return {
    type: "library",
    name,
    version: version || "unknown",
    scope,
    "bom-ref": `pkg:npm/${name}@${version || "unknown"}`,
    purl: `pkg:npm/${encodeURIComponent(name)}@${version || "unknown"}`,
  };
}

const components = [];
for (const [name, range] of Object.entries(pkg.dependencies || {})) {
  components.push(component(name, resolvedVersion(name) || String(range), "required"));
}
for (const [name, range] of Object.entries(pkg.devDependencies || {})) {
  components.push(component(name, resolvedVersion(name) || String(range), "optional"));
}

const bom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: {
      type: "application",
      name: pkg.name,
      version: pkg.version,
      description: pkg.description,
    },
    tools: [{ vendor: "cad-backend", name: "generate-sbom.js", version: "1.0.0" }],
    properties: [
      {
        name: "cad:classification",
        value: "runtime=dependencies; build/dev=devDependencies (not packaged to Lambda)",
      },
      {
        name: "cad:lockfile",
        value: "package-lock.json (committed; npm ci required in CI)",
      },
    ],
  },
  components,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Wrote ${outPath} (${components.length} direct components)`);
