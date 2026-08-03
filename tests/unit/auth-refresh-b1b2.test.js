/**
 * B1/B2: refresh missing cookie → 401; logout clears cookies (unit).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const authService = require("../../src/services/auth.service");
const { UnauthorizedError } = require("../../src/utils/errors");
const { clearSessionCookies, attachSessionCookies } = require("../../src/utils/authCookies");
const { ok } = require("../../src/utils/response");
const { rejectClientSketchPaymentAmount } = require("../../src/middleware/validator");
const { BadRequestError } = require("../../src/utils/errors");

describe("B1 refresh without token", () => {
  it("refreshSession without refreshToken → 401", async () => {
    await assert.rejects(
      () => authService.refreshSession({}),
      (err) => err instanceof UnauthorizedError && err.code === "REFRESH_TOKEN_MISSING"
    );
    await assert.rejects(
      () => authService.refreshSession({ refreshToken: null }),
      (err) => err instanceof UnauthorizedError && err.statusCode === 401
    );
  });
});

describe("B2 logout clears cookie", () => {
  it("clearSessionCookies sets Max-Age=0 on refresh cookie", () => {
    const loggedIn = attachSessionCookies(ok({ accessToken: "a", refreshToken: "r" }), {
      refreshToken: "r",
    });
    assert.ok(loggedIn.cookies.some((c) => c.startsWith("cad_refresh=") && c.includes("HttpOnly")));
    const loggedOut = clearSessionCookies(ok({ message: "Logged out" }));
    assert.ok(loggedOut.cookies.some((c) => c.startsWith("cad_refresh=") && /Max-Age=0/.test(c)));
  });

  it("logout without token is idempotent", async () => {
    const result = await authService.logout({});
    assert.equal(result.message, "Logged out");
  });
});

describe("C-01 client amount rejected", () => {
  it("rejects amount / amountRupees / amountPaise", () => {
    for (const body of [{ amount: 100 }, { amountRupees: 100 }, { amountPaise: 10000 }]) {
      assert.throws(
        () => rejectClientSketchPaymentAmount(body),
        (err) => err instanceof BadRequestError && err.code === "CLIENT_AMOUNT_NOT_ALLOWED"
      );
    }
    assert.doesNotThrow(() => rejectClientSketchPaymentAmount({ isSuperimpose: true }));
  });
});
