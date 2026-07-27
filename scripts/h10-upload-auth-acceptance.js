/**
 * H-10 acceptance: anonymous upload closed; auth + binding + size controls present.
 */
const fs = require("fs");
const path = require("path");

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

async function main() {
  assert("SECURITY_H10 doc", fs.existsSync(path.join(root, "docs/SECURITY_H10_UPLOAD_AUTH.md")));
  assert("FE H-10 doc", fs.existsSync(path.join(root, "docs/FRONTEND_H10_UPLOAD_AUTH.md")));

  const uploadApi = fs.readFileSync(path.join(root, "src/handlers/uploadApi.js"), "utf8");
  assert("uploadApi always authorize before routes", /await uploadAuth\(\)\(event\)/.test(uploadApi));
  assert("no anonymous optional auth path", !/optionalAuth|optional.?auth/i.test(uploadApi));

  const uploadSvc = fs.readFileSync(path.join(root, "src/services/upload.service.js"), "utf8");
  assert("UnauthorizedError on missing user", /UPLOAD_AUTH_REQUIRED/.test(uploadSvc));
  assert("size always required", /UPLOAD_SIZE_REQUIRED/.test(uploadSvc));
  assert("daily quota", /UPLOAD_QUOTA_FILES/.test(uploadSvc));
  assert("key ownership check", /assertKeyOwnedByUser/.test(uploadSvc));
  assert("order binding", /resolveBoundEntityId/.test(uploadSvc));
  assert("presign rate limit call", /assertUploadPresignAllowed/.test(uploadSvc));
  assert("user-bound buildUploadKey arity", /buildUploadKey\([^)]*user\._id/.test(uploadSvc));

  const s3 = fs.readFileSync(path.join(root, "src/utils/s3.js"), "utf8");
  assert("S3 key includes /user/", /\/user\//.test(s3));

  const throttle = fs.readFileSync(path.join(root, "src/services/authThrottle.service.js"), "utf8");
  assert("assertUploadPresignAllowed exported", /assertUploadPresignAllowed/.test(throttle));

  const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
  assert("UPLOAD_REQUIRE_AUTH default true", /UPLOAD_REQUIRE_AUTH:.*'true'/.test(yml));
  assert("UPLOAD_REQUIRE_SIZE default true", /UPLOAD_REQUIRE_SIZE:.*'true'/.test(yml));
  assert("presign rate env", /UPLOAD_PRESIGN_MAX_PER_WINDOW:/.test(yml));
  assert("daily quota env", /UPLOAD_DAILY_FILE_QUOTA:/.test(yml));

  const { UnauthorizedError } = require("../src/utils/errors");
  const { getImageUploadUrl, validateImageUpload } = require("../src/services/upload.service");

  try {
    validateImageUpload({ fileName: "a.png", contentType: "image/png" });
    assert("validate rejects missing size", false);
  } catch (e) {
    assert("validate rejects missing size", e.code === "UPLOAD_SIZE_REQUIRED", e && e.message);
  }

  try {
    await getImageUploadUrl(
      { fileName: "a.png", contentType: "image/png", fileSizeBytes: 10 },
      null
    );
    assert("runtime unauthenticated presign → 401", false);
  } catch (e) {
    assert(
      "runtime unauthenticated presign → 401",
      e instanceof UnauthorizedError && e.statusCode === 401,
      e && e.message
    );
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert("test:h10 script", typeof pkg.scripts["test:h10"] === "string");

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
