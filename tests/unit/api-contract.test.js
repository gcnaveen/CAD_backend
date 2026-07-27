/**
 * H-04: API contract smoke — critical route methods/paths exist in serverless.yml
 * and handler exports match (no live HTTP).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const yml = fs.readFileSync(path.join(root, "serverless.yml"), "utf8");
const authHandler = require("../../src/handlers/auth.handler");

const REQUIRED_ROUTES = [
  { path: "/api/auth/login", method: "post" },
  { path: "/api/auth/refresh", method: "post" },
  { path: "/api/payments/phonepe/callback", method: "get" },
  { path: "/api/surveyor/sketch-pricing", method: "get" },
  { path: "/api/upload/image", method: "post" },
];

describe("API contract: serverless routes present", () => {
  for (const r of REQUIRED_ROUTES) {
    it(`${r.method.toUpperCase()} ${r.path}`, () => {
      assert.match(yml, new RegExp(`path:\\s*${r.path.replace(/\//g, "\\/")}`));
      // method appears near path in serverless httpApi events
      const idx = yml.indexOf(`path: ${r.path}`);
      assert.ok(idx >= 0, `missing path ${r.path}`);
      const window = yml.slice(Math.max(0, idx - 80), idx + 120);
      assert.match(window, new RegExp(`method:\\s*${r.method}`, "i"));
    });
  }
});

describe("API contract: handler exports for critical flows", () => {
  it("exports phonePe callback, refresh, logout", () => {
    assert.equal(typeof authHandler.phonePeSketchCallback, "function");
    assert.equal(typeof authHandler.refreshSession, "function");
    assert.equal(typeof authHandler.logout, "function");
  });
});
