/**
 * M-02: HttpOnly refresh cookie + CSRF helpers.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachSessionCookies,
  clearSessionCookies,
  getRefreshTokenFromRequest,
  assertCsrfIfCookieAuth,
  useRefreshCookie,
} = require("../../src/utils/authCookies");
const { ok } = require("../../src/utils/response");
const { UnauthorizedError } = require("../../src/utils/errors");

describe("M-02 auth cookies", () => {
  const prev = {};
  const keys = ["AUTH_USE_REFRESH_COOKIE", "AUTH_OMIT_REFRESH_IN_BODY", "AUTH_COOKIE_SECURE"];

  before(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.AUTH_USE_REFRESH_COOKIE = "true";
    process.env.AUTH_COOKIE_SECURE = "false";
  });

  after(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("sets HttpOnly refresh + readable csrf cookies", () => {
    assert.equal(useRefreshCookie(), true);
    const res = attachSessionCookies(ok({ accessToken: "a", refreshToken: "r1" }), {
      accessToken: "a",
      refreshToken: "r1",
    });
    assert.ok(Array.isArray(res.cookies) && res.cookies.length >= 2);
    assert.ok(res.cookies.some((c) => c.startsWith("cad_refresh=") && c.includes("HttpOnly")));
    assert.ok(res.cookies.some((c) => c.startsWith("cad_csrf=") && !c.includes("HttpOnly")));
    const body = JSON.parse(res.body);
    assert.ok(body.data.csrfToken);
    assert.equal(body.data.authStorage.accessToken, "memory");
  });

  it("reads refresh from cookie when body empty", () => {
    const token = getRefreshTokenFromRequest(
      { headers: { cookie: "cad_refresh=rawtoken; cad_csrf=abc" } },
      {}
    );
    assert.equal(token, "rawtoken");
  });

  it("CSRF required for cookie-based refresh", () => {
    assert.throws(
      () =>
        assertCsrfIfCookieAuth(
          { headers: { cookie: "cad_refresh=raw; cad_csrf=abc" } },
          {}
        ),
      (err) => err instanceof UnauthorizedError && err.code === "CSRF_INVALID"
    );
    assert.doesNotThrow(() =>
      assertCsrfIfCookieAuth(
        {
          headers: {
            cookie: "cad_refresh=raw; cad_csrf=abc",
            "x-csrf-token": "abc",
          },
        },
        {}
      )
    );
    // Legacy body refresh skips CSRF
    assert.doesNotThrow(() =>
      assertCsrfIfCookieAuth({ headers: { cookie: "cad_refresh=raw; cad_csrf=abc" } }, {
        refreshToken: "legacy",
      })
    );
  });

  it("clearSessionCookies expires cookies", () => {
    const res = clearSessionCookies(ok({ message: "Logged out" }));
    assert.ok(res.cookies.every((c) => /Max-Age=0/.test(c)));
  });
});
