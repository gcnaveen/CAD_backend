/**
 * List Mongoose schema-declared indexes (H-06 architecture evidence).
 * Usage: node scripts/list-schema-indexes.js
 */
const fs = require("fs");
const path = require("path");

const modelsRoot = path.join(__dirname, "..", "src", "models");

function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.name.endsWith(".js")) acc.push(p);
  }
  return acc;
}

const files = walk(modelsRoot);
const rows = [];

for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const rel = path.relative(path.join(__dirname, ".."), file);
  const indexCalls = [...src.matchAll(/\.index\s*\(\s*(\{[\s\S]*?\})\s*(?:,\s*(\{[\s\S]*?\}))?\s*\)/g)];
  for (const m of indexCalls) {
    rows.push({ file: rel, kind: "schema.index", spec: m[1].replace(/\s+/g, " ").slice(0, 120), options: m[2] || "" });
  }
  if (/index:\s*true/.test(src) || /unique:\s*true/.test(src)) {
    const fieldHits = [...src.matchAll(/^\s*([a-zA-Z0-9_."]+)\s*:[^;\n]*(index:\s*true|unique:\s*true)/gm)];
    for (const h of fieldHits) {
      rows.push({ file: rel, kind: "field", spec: h[0].trim().slice(0, 120) });
    }
  }
}

console.log(`# Schema index inventory (${rows.length} entries)\n`);
for (const r of rows) {
  console.log(`- ${r.file} [${r.kind}] ${r.spec}${r.options ? " " + r.options.replace(/\s+/g, " ").slice(0, 60) : ""}`);
}

if (!rows.length) {
  console.error("No indexes found");
  process.exit(1);
}
