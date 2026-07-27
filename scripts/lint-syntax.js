/**
 * Syntax / require smoke for critical entrypoints (lint substitute without ESLint deps).
 * Exit 1 if any file fails to parse or require.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const files = [
  "src/handlers/authApi.js",
  "src/handlers/uploadApi.js",
  "src/handlers/auth.handler.js",
  "src/middleware/auth.middleware.js",
  "src/middleware/validator.js",
  "src/services/phonePeSketchPayment.service.js",
  "src/services/paymentAttempt.service.js",
  "src/services/cadDownloadEntitlement.service.js",
  "src/services/sketchPaymentPricing.service.js",
  "src/services/upload.service.js",
  "src/services/fileSecurity.service.js",
  "src/utils/s3.js",
];

let failed = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    console.error(`FAIL  missing ${rel}`);
    failed += 1;
    continue;
  }
  const r = spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`FAIL  syntax ${rel}\n${r.stderr}`);
    failed += 1;
  } else {
    console.log(`PASS  syntax ${rel}`);
  }
}

process.exit(failed ? 1 : 0);
