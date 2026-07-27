#!/usr/bin/env node
/**
 * Apply S3 bucket CORS for browser presigned PUT (voice notes / sketch images).
 * Usage: node scripts/apply-s3-cors.js
 * Requires: S3_BUCKET in env/.env and iam:s3:PutBucketCors on that bucket.
 */
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } = require("@aws-sdk/client-s3");

async function main() {
  const bucket = String(process.env.S3_BUCKET || "").trim();
  if (!bucket) {
    console.error("ERROR: S3_BUCKET is required");
    process.exit(1);
  }
  const corsPath = path.join(__dirname, "..", "s3-cors.example.json");
  const cfg = JSON.parse(fs.readFileSync(corsPath, "utf8"));
  const region = process.env.AWS_REGION || process.env.REGION || "ap-south-1";
  const client = new S3Client({ region });

  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: cfg.CORSRules || cfg },
    })
  );
  const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  console.log(`S3 CORS applied on s3://${bucket} (${region})`);
  console.log(JSON.stringify(current.CORSRules, null, 2));
}

main().catch((err) => {
  console.error(`Failed to apply S3 CORS: ${err.message}`);
  console.error("Grant s3:PutBucketCors on the bucket (or set CORS in AWS Console from s3-cors.example.json).");
  process.exit(1);
});
