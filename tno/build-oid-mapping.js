/**
 * Build tno/oid-mapping.json so that district/taluk OIDs in taluks and hoblis
 * can be mapped to the district_id (and thus to our seeded districts).
 *
 * Use when tnov1.districts.json has different _id values than the "district"
 * OIDs referenced in tnov1.taluks.json (e.g. exports from different DBs).
 *
 * You need an export of the DISTRICTS collection from the SAME database that
 * was used to export taluks/hoblis. That export must include _id and district_id.
 * Save it as: tno/taluks-source-districts.json
 *
 * Then run:
 *   node tno/build-oid-mapping.js
 *
 * This produces tno/oid-mapping.json with districtOidToDistrictId mapping.
 * Then run: node tno/seed-districts-taluks-hoblis.js
 */

const path = require("path");
const fs = require("fs");

const TNO_DIR = __dirname;

function oidStr(ob) {
  if (!ob) return null;
  if (typeof ob === "string") return ob;
  if (ob && ob.$oid) return ob.$oid;
  return null;
}

function loadJson(name) {
  const filePath = path.join(TNO_DIR, name);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

const sourcePath = path.join(TNO_DIR, "taluks-source-districts.json");
if (!fs.existsSync(sourcePath)) {
  console.error("Missing file: tno/taluks-source-districts.json");
  console.error("");
  console.error("Export the districts collection from the SAME DB that was used");
  console.error("for tnov1.taluks.json (must have _id and district_id per doc).");
  console.error("Save as tno/taluks-source-districts.json and run this script again.");
  process.exit(1);
}

const raw = loadJson("taluks-source-districts.json");
const sourceDistricts = Array.isArray(raw) ? raw : [raw];

const districtOidToDistrictId = {};
for (const d of sourceDistricts) {
  const oid = oidStr(d._id);
  const districtId = d.district_id;
  if (oid != null && districtId != null) {
    districtOidToDistrictId[oid] = districtId;
  }
}

const out = {
  districtOidToDistrictId,
};

const outPath = path.join(TNO_DIR, "oid-mapping.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");
console.log("Wrote", outPath, "with", Object.keys(districtOidToDistrictId).length, "district OID -> district_id mappings.");
