/**
 * H-05: version endpoint shape (no network).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

process.env.BUILD_GIT_SHA = "a".repeat(40);
process.env.BUILD_LOCK_HASH = "b".repeat(64);
process.env.BUILD_DEPLOYED_AT = "2026-07-25T00:00:00.000Z";
process.env.BUILD_MIGRATION_VERSION = "test.migration";
process.env.STAGE = "dev";

const { getBuildIdentity } = require("../../src/config/buildIdentity");
const versionHandler = require("../../src/handlers/versionApi");

describe("build identity / version", () => {
  it("getBuildIdentity returns safe fields", () => {
    const id = getBuildIdentity();
    assert.equal(id.gitSha, "a".repeat(40));
    assert.equal(id.lockHash, "b".repeat(64));
    assert.equal(id.stage, "dev");
    assert.equal(id.migrationVersion, "test.migration");
    assert.ok(!("JWT_SECRET" in id));
    assert.ok(!("MONGODB_URI" in id));
  });

  it("version handler returns 200 JSON", async () => {
    const res = await versionHandler.handler({});
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.gitSha, "a".repeat(40));
  });
});
