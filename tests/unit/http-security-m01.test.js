/**
 * M-01: CORS allow-list + security headers.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseAllowlist,
  resolveAllowOrigin,
  securityHeaders,
  applySecurityHeaders,
  assertCorsConfigReady,
} = require("../../src/utils/httpSecurity");

describe("M-01 http security", () => {
  const prev = {};
  const keys = [
    "CORS_ALLOW_ORIGINS",
    "CORS_ALLOW_ORIGIN",
    "STAGE",
    "NODE_ENV",
    "ENABLE_HSTS",
    "PHONEPE_SUCCESS_REDIRECT_URL",
    "PHONEPE_FAILURE_REDIRECT_URL",
    "PUBLIC_FRONTEND_ORIGIN",
    "FRONTEND_ORIGIN",
    "CORS_EXTRA_ORIGINS",
  ];

  before(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  after(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("never resolves wildcard; reflects allow-listed origin", () => {
    process.env.CORS_ALLOW_ORIGINS = "https://app.example.com,https://admin.example.com";
    assert.equal(
      resolveAllowOrigin({ headers: { origin: "https://app.example.com" } }),
      "https://app.example.com"
    );
    assert.equal(resolveAllowOrigin({ headers: { origin: "https://evil.example" } }), null);
    assert.ok(!parseAllowlist().includes("*"));
  });

  it("security headers include nosniff, frame deny, CSP frame-ancestors", () => {
    const h = securityHeaders();
    assert.equal(h["x-content-type-options"], "nosniff");
    assert.equal(h["x-frame-options"], "DENY");
    assert.match(h["content-security-policy"], /frame-ancestors 'none'/);
    assert.ok(h["referrer-policy"]);
    assert.ok(h["permissions-policy"]);
  });

  it("applySecurityHeaders strips * and sets allow origin", () => {
    process.env.CORS_ALLOW_ORIGINS = "https://app.example.com";
    const out = applySecurityHeaders(
      { headers: { origin: "https://app.example.com" } },
      {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
        body: "{}",
      }
    );
    assert.equal(out.headers["access-control-allow-origin"], "https://app.example.com");
    assert.equal(out.headers["x-content-type-options"], "nosniff");
  });

  it("prod without allow-list fails closed", () => {
    process.env.STAGE = "prod";
    delete process.env.CORS_ALLOW_ORIGINS;
    delete process.env.PHONEPE_SUCCESS_REDIRECT_URL;
    delete process.env.PHONEPE_FAILURE_REDIRECT_URL;
    delete process.env.PUBLIC_FRONTEND_ORIGIN;
    delete process.env.FRONTEND_ORIGIN;
    delete process.env.CORS_EXTRA_ORIGINS;
    assert.throws(() => assertCorsConfigReady(), (err) => err.code === "CORS_CONFIG_MISSING");
  });

  it("merges PhonePe / frontend companion origins into allow-list", () => {
    process.env.STAGE = "dev";
    process.env.CORS_ALLOW_ORIGINS = "http://localhost:5173";
    process.env.PHONEPE_SUCCESS_REDIRECT_URL = "https://north-cot.com/dashboard/user";
    process.env.PUBLIC_FRONTEND_ORIGIN = "https://www.north-cot.com";
    const list = parseAllowlist();
    assert.ok(list.includes("http://localhost:5173"));
    assert.ok(list.includes("https://north-cot.com"));
    assert.ok(list.includes("https://www.north-cot.com"));
    assert.equal(
      resolveAllowOrigin({ headers: { origin: "https://north-cot.com" } }),
      "https://north-cot.com"
    );
  });

  it("explicit * fails closed", () => {
    process.env.STAGE = "dev";
    process.env.CORS_ALLOW_ORIGINS = "*";
    assert.throws(() => assertCorsConfigReady(), (err) => err.code === "CORS_WILDCARD_FORBIDDEN");
  });
});
