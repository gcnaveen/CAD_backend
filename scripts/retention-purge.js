/**
 * H-07 retention dry-run / purge stub.
 * Lists candidate SurveyorSketchUpload docs older than FILE_RETENTION_DAYS.
 * Does not delete unless --execute (requires Mongo).
 *
 * Usage:
 *   node scripts/retention-purge.js --dry-run
 *   node scripts/retention-purge.js --execute   # deletes soft-cleared orphans only when wired
 */
require("dotenv").config();
const { retentionCutoffDate, getRetentionDays, recordRetentionDeletion } = require("../src/services/fileRetention.service");

async function main() {
  const execute = process.argv.includes("--execute");
  const cutoff = retentionCutoffDate();
  console.log(`Retention days=${getRetentionDays()} cutoff=${cutoff.toISOString()} execute=${execute}`);

  if (!process.env.MONGODB_URI && !process.env.MONGODB_URI_STANDARD) {
    console.log("No Mongo URI — printing policy only.");
    console.log("Wire Atlas backup restore drill + S3 lifecycle to match FILE_RETENTION_DAYS.");
    process.exit(0);
  }

  const { connectDB, mongoose } = require("../src/config/db");
  await connectDB();
  const SurveyorSketchUpload = require("../src/models/surveyor/SurveyorSketchUpload");

  const candidates = await SurveyorSketchUpload.find({
    updatedAt: { $lt: cutoff },
    status: { $in: ["REJECTED", "CANCELLED"] },
  })
    .select("_id applicationId status updatedAt")
    .limit(50)
    .lean();

  console.log(`Candidates (sample ≤50): ${candidates.length}`);
  for (const c of candidates) {
    console.log(` - ${c._id} ${c.status} ${c.updatedAt}`);
    if (execute) {
      await recordRetentionDeletion({
        uploadId: c._id,
        meta: { applicationId: c.applicationId, status: c.status },
      });
    }
  }

  if (!execute) {
    console.log("Dry-run only. Pass --execute to write RETENTION_DELETE audit rows (does not hard-delete yet).");
  }

  await mongoose.connection.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
