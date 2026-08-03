#!/usr/bin/env node
/**
 * Normalize User.role and User.status to canonical uppercase (audit role-case mismatch).
 *
 * Usage:
 *   node scripts/migrate-normalize-user-roles.js --dry-run
 *   node scripts/migrate-normalize-user-roles.js
 *
 * Requires MONGODB_URI (loads .env when present).
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { USER_ROLES, USER_STATUS } = require("../src/config/constants");
const { MIGRATION_VERSION } = require("../src/config/schemaVersion");

const dryRun = process.argv.includes("--dry-run");

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URI_STANDARD;
  if (!uri) {
    console.error("ERROR: MONGODB_URI is required");
    process.exit(1);
  }

  await mongoose.connect(uri);
  const col = mongoose.connection.collection("users");

  const roleCanon = Object.values(USER_ROLES);
  const statusCanon = Object.values(USER_STATUS);

  const cursor = col.find(
    {},
    { projection: { role: 1, status: 1, "auth.email": 1, "auth.phone": 1 } }
  );

  let scanned = 0;
  let roleFixed = 0;
  let statusFixed = 0;
  let skippedUnknown = 0;
  const samples = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    scanned += 1;
    const updates = {};

    if (doc.role != null) {
      const upper = String(doc.role).trim().toUpperCase();
      if (roleCanon.includes(upper) && doc.role !== upper) {
        updates.role = upper;
        roleFixed += 1;
        if (samples.length < 20) {
          samples.push({ _id: String(doc._id), from: doc.role, to: upper, field: "role" });
        }
      } else if (!roleCanon.includes(upper)) {
        skippedUnknown += 1;
        console.warn(`WARN unknown role left unchanged: ${doc._id} role=${JSON.stringify(doc.role)}`);
      }
    }

    if (doc.status != null) {
      const upper = String(doc.status).trim().toUpperCase();
      if (statusCanon.includes(upper) && doc.status !== upper) {
        updates.status = upper;
        statusFixed += 1;
        if (samples.length < 20) {
          samples.push({ _id: String(doc._id), from: doc.status, to: upper, field: "status" });
        }
      }
    }

    if (!dryRun && Object.keys(updates).length > 0) {
      await col.updateOne({ _id: doc._id }, { $set: updates });
    }
  }

  console.log(
    JSON.stringify(
      {
        migrationVersion: MIGRATION_VERSION,
        dryRun,
        scanned,
        roleFixed,
        statusFixed,
        skippedUnknown,
        samples,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
