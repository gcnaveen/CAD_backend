/**
 * Seed script: import districts, taluks, hoblis, and villages from TNO JSON files
 * into the app's District, Taluka, Hobli, Village collections with correct references.
 *
 * Prerequisites:
 * - .env with MONGODB_URI or MONGODB_URI_STANDARD
 * - JSON files: tnov1.districts.json, tnov1.taluks.json, tnov1.hoblis.json, tnov1.villages.json
 *
 * If taluks/hoblis reference district (or taluk) OIDs that do NOT match
 * the _id in tnov1.districts.json, create tno/oid-mapping.json (see README)
 * or run: node tno/build-oid-mapping.js
 *
 * Usage:
 *   node tno/seed-districts-taluks-hoblis.js           # run import
 *   node tno/seed-districts-taluks-hoblis.js --dry-run # show what would be done
 */

const path = require("path");
const fs = require("fs");

// Load env and DB (same as app)
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
}

const mongoose = require("mongoose");
const { connectDB, disconnectDB } = require("../src/config/database");
const District = require("../src/models/masters/District");
const Taluka = require("../src/models/masters/Taluka");
const Hobli = require("../src/models/masters/Hobli");
const Village = require("../src/models/masters/Village");
const { MASTER_STATUS } = require("../src/config/constants");

const DRY_RUN = process.argv.includes("--dry-run");
const TNO_DIR = __dirname;

function normalizeAscii(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
}

function baseShortCodeFromName(name, maxLen = 6) {
  const cleaned = normalizeAscii(name).toUpperCase().replace(/\s+/g, " ");
  if (!cleaned) return null;
  const parts = cleaned.split(" ").filter(Boolean);
  // Prefer acronym when multiple words (e.g. BENGALURU URBAN => BU)
  let code = "";
  if (parts.length >= 2) {
    code = parts.map((p) => p[0]).join("");
  } else {
    // Single word: remove vowels after first char to compress
    const w = parts[0];
    code = w[0] + w.slice(1).replace(/[AEIOU]/g, "");
  }
  code = code.replace(/[^A-Z0-9]/g, "");
  if (!code) code = parts.join("").replace(/[^A-Z0-9]/g, "");
  return code.slice(0, maxLen);
}

async function makeUniqueCode({ Model, scopeQuery, name, maxLen = 6 }) {
  const base = baseShortCodeFromName(name, maxLen) || "X";
  // Try base, then base + 2-digit suffix.
  // Important: if base is already maxLen, we must shorten base to make room for suffix,
  // otherwise slicing would drop the suffix and keep colliding (e.g. SHVMGG + 01 => SHVMGG).
  for (let i = 0; i < 100; i++) {
    let candidate;
    if (i === 0) {
      candidate = base.slice(0, maxLen);
    } else {
      const suffix = String(i).padStart(2, "0");
      const room = Math.max(1, maxLen - suffix.length);
      const b = base.slice(0, room);
      candidate = `${b}${suffix}`.slice(0, maxLen);
    }
    // eslint-disable-next-line no-await-in-loop
    const exists = await Model.findOne({ ...scopeQuery, code: candidate }).select("_id").lean();
    if (!exists) return candidate;
  }
  // Fallback: append timestamp-derived suffix (still bounded)
  const suffix = (Date.now() % 1000000).toString(36).toUpperCase();
  const room = Math.max(1, maxLen - Math.min(3, suffix.length));
  const b = base.slice(0, room);
  return `${b}${suffix}`.slice(0, maxLen);
}

function loadJson(name) {
  const filePath = path.join(TNO_DIR, name);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function oidStr(ob) {
  if (!ob) return null;
  if (typeof ob === "string") return ob;
  if (ob && ob.$oid) return ob.$oid;
  return null;
}

function statusFromFlags(isActive, isArchived) {
  if (isActive === false || isArchived === true) return MASTER_STATUS.INACTIVE;
  return MASTER_STATUS.ACTIVE;
}

async function run() {
  console.log("TNO seed script. Dry run:", DRY_RUN);
  console.log("Loading JSON files...");

  const districtsRaw = loadJson("tnov1.districts.json");
  const taluksRaw = loadJson("tnov1.taluks.json");
  const hoblisRaw = loadJson("tnov1.hoblis.json");
  const villagesRaw = loadJson("tnov1.villages.json");

  const districts = Array.isArray(districtsRaw) ? districtsRaw : [districtsRaw];
  const taluks = Array.isArray(taluksRaw) ? taluksRaw : [taluksRaw];
  const hoblis = Array.isArray(hoblisRaw) ? hoblisRaw : [hoblisRaw];
  const villages = Array.isArray(villagesRaw) ? villagesRaw : [villagesRaw];

  let oidMapping = {};
  const mappingPath = path.join(TNO_DIR, "oid-mapping.json");
  if (fs.existsSync(mappingPath)) {
    oidMapping = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
    console.log("Loaded oid-mapping.json: districtOidToDistrictId keys =", Object.keys(oidMapping.districtOidToDistrictId || {}).length);
  }

  const districtOidToDistrictId = oidMapping.districtOidToDistrictId || {};

  if (!DRY_RUN) {
    await connectDB();
  }

  // --- 1) Districts: insert and build maps ---
  // Map: old _id (from file) -> new ObjectId
  const districtOldOidToNewOid = {};
  // Map: district_id (numeric) -> new ObjectId (so we can resolve via oid-mapping)
  const districtIdToNewOid = {};

  console.log("\n--- Districts ---");
  for (const d of districts) {
    const oldOid = oidStr(d._id);
    const districtId = d.district_id;
    const name = (d.name || d.k_name || "").trim();
    const status = statusFromFlags(d.is_active, d.is_archived);

    if (!name) {
      console.warn("Skip district: missing name, district_id=", districtId);
      continue;
    }

    if (DRY_RUN) {
      if (oldOid) districtOldOidToNewOid[oldOid] = `DRYRUN_DISTRICT_${name}`;
      if (districtId != null) districtIdToNewOid[districtId] = `DRYRUN_DISTRICT_${name}`;
      console.log("  Would insert District:", { code: "<name-based>", name, status });
      continue;
    }

    // District code should be a short code derived from name (not numeric id)
    // Keep existing by name match; otherwise create with a unique short code.
    const existing = await District.findOne({ name });
    let doc;
    if (existing) {
      doc = existing;
      console.log("  Exists (skip insert):", doc.code, name);
    } else {
      // eslint-disable-next-line no-await-in-loop
      const code = await makeUniqueCode({ Model: District, scopeQuery: {}, name, maxLen: 6 });
      doc = await District.create({ code, name, status });
      console.log("  Inserted:", doc.code, name);
    }
    const newOid = doc._id.toString();
    if (oldOid) districtOldOidToNewOid[oldOid] = doc._id;
    if (districtId != null) districtIdToNewOid[districtId] = doc._id;
  }

  // --- 2) Taluks: resolve district, then insert ---
  const talukOldOidToNewOid = {};

  console.log("\n--- Taluks ---");
  let talukSkipped = 0;
  for (const t of taluks) {
    const districtRef = oidStr(t.district);
    let newDistrictId = districtOldOidToNewOid[districtRef] ?? null;
    if (!newDistrictId && districtRef && districtOidToDistrictId[districtRef] != null) {
      const numericId = districtOidToDistrictId[districtRef];
      newDistrictId = districtIdToNewOid[numericId] ?? null;
    }
    if (!newDistrictId) {
      talukSkipped++;
      if (talukSkipped <= 3) {
        console.warn("  Skip taluk (no district mapping):", t.name, "district OID:", districtRef);
      }
      continue;
    }

    const oldTalukOid = oidStr(t._id);
    const name = (t.name || t.k_name || "").trim();
    const status = statusFromFlags(t.is_active, t.is_archived);

    if (!name) {
      talukSkipped++;
      continue;
    }

    if (DRY_RUN) {
      if (oldTalukOid) talukOldOidToNewOid[oldTalukOid] = `DRYRUN_TALUK_${name}`;
      console.log("  Would insert Taluka:", { code: "<name-based>", name, districtId: newDistrictId });
      continue;
    }

    const existing = await Taluka.findOne({ districtId: newDistrictId, name });
    let doc;
    if (existing) {
      doc = existing;
    } else {
      // eslint-disable-next-line no-await-in-loop
      const code = await makeUniqueCode({ Model: Taluka, scopeQuery: { districtId: newDistrictId }, name, maxLen: 6 });
      doc = await Taluka.create({
        districtId: newDistrictId,
        code,
        name,
        status,
      });
    }
    if (oldTalukOid) talukOldOidToNewOid[oldTalukOid] = doc._id;
  }
  if (talukSkipped > 0) {
    console.log("  Skipped taluks (no district mapping):", talukSkipped);
  }

  // --- 3) Hoblis: resolve district and taluk, then insert ---
  const hobliOldOidToNewOid = {};
  console.log("\n--- Hoblis ---");
  let hobliSkipped = 0;
  for (const h of hoblis) {
    const districtRef = oidStr(h.district);
    let newDistrictId = districtOldOidToNewOid[districtRef] ?? null;
    if (!newDistrictId && districtRef && districtOidToDistrictId[districtRef] != null) {
      const numericId = districtOidToDistrictId[districtRef];
      newDistrictId = districtIdToNewOid[numericId] ?? null;
    }
    const talukRef = oidStr(h.taluk);
    const newTalukId = talukOldOidToNewOid[talukRef] ?? null;

    if (!newDistrictId || !newTalukId) {
      hobliSkipped++;
      if (hobliSkipped <= 3) {
        console.warn("  Skip hobli (no district/taluk mapping):", h.name, "district:", districtRef, "taluk:", talukRef);
      }
      continue;
    }

    const oldHobliOid = oidStr(h._id);
    const name = (h.name || "").trim();
    const status = statusFromFlags(h.is_active, h.is_archived);

    if (!name) {
      hobliSkipped++;
      continue;
    }

    if (DRY_RUN) {
      if (oldHobliOid) hobliOldOidToNewOid[oldHobliOid] = `DRYRUN_HOBLI_${name}`;
      console.log("  Would insert Hobli:", { code: "<name-based>", name, districtId: newDistrictId, talukaId: newTalukId });
      continue;
    }

    const existing = await Hobli.findOne({ talukaId: newTalukId, name });
    if (existing) {
      // no need to store mapping for hoblis
      if (oldHobliOid) hobliOldOidToNewOid[oldHobliOid] = existing._id;
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const code = await makeUniqueCode({ Model: Hobli, scopeQuery: { talukaId: newTalukId }, name, maxLen: 6 });
    const hobliDoc = await Hobli.create({
      districtId: newDistrictId,
      talukaId: newTalukId,
      code,
      name,
      status,
    });
    if (oldHobliOid) hobliOldOidToNewOid[oldHobliOid] = hobliDoc._id;
  }
  if (hobliSkipped > 0) {
    console.log("  Skipped hoblis (no district/taluk mapping):", hobliSkipped);
  }

  // --- 4) Villages: resolve district, taluk, hobli, then insert ---
  console.log("\n--- Villages ---");
  let villageSkipped = 0;
  for (const v of villages) {
    const districtRef = oidStr(v.district);
    let newDistrictId = districtOldOidToNewOid[districtRef] ?? null;
    if (!newDistrictId && districtRef && districtOidToDistrictId[districtRef] != null) {
      const numericId = districtOidToDistrictId[districtRef];
      newDistrictId = districtIdToNewOid[numericId] ?? null;
    }
    const talukRef = oidStr(v.taluk);
    const hobliRef = oidStr(v.hobli);
    const newTalukId = talukOldOidToNewOid[talukRef] ?? null;
    const newHobliId = hobliOldOidToNewOid[hobliRef] ?? null;

    if (!newDistrictId || !newTalukId || !newHobliId) {
      villageSkipped++;
      if (villageSkipped <= 3) {
        console.warn(
          "  Skip village (no district/taluk/hobli mapping):",
          v.name,
          "district:",
          districtRef,
          "taluk:",
          talukRef,
          "hobli:",
          hobliRef
        );
      }
      continue;
    }

    const name = (v.name || "").trim();
    const status = statusFromFlags(v.is_active, v.is_archived);

    if (!name) {
      villageSkipped++;
      continue;
    }

    if (DRY_RUN) {
      console.log("  Would insert Village:", {
        code: "<name-based>",
        name,
        districtId: newDistrictId,
        talukaId: newTalukId,
        hobliId: newHobliId,
      });
      continue;
    }

    const existing = await Village.findOne({ hobliId: newHobliId, name });
    if (existing) continue;

    // eslint-disable-next-line no-await-in-loop
    const code = await makeUniqueCode({
      Model: Village,
      scopeQuery: { hobliId: newHobliId },
      name,
      maxLen: 8,
    });
    await Village.create({
      districtId: newDistrictId,
      talukaId: newTalukId,
      hobliId: newHobliId,
      code,
      name,
      status,
    });
  }
  if (villageSkipped > 0) {
    console.log("  Skipped villages (no district/taluk/hobli mapping):", villageSkipped);
  }

  console.log("\nDone.");
  if (!DRY_RUN) {
    await disconnectDB();
  }
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
