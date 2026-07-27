/**
 * H-04: authorization matrix (JWT + role gates).
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = process.env.JWT_SECRET || "h04-test-jwt-secret-at-least-32-chars!!";

const User = require("../../src/models/user/User");
const { USER_ROLES, USER_STATUS } = require("../../src/config/constants");
const {
  generateAccessToken,
  generateMfaPendingToken,
  authorize,
  extractToken,
} = require("../../src/middleware/auth.middleware");
const { UnauthorizedError, ForbiddenError } = require("../../src/utils/errors");

describe("authz: extractToken", () => {
  it("parses Bearer header", () => {
    assert.equal(extractToken({ headers: { authorization: "Bearer abc" } }), "abc");
    assert.equal(extractToken({ headers: {} }), null);
  });
});

describe("authz: role matrix", () => {
  let origFind;
  const users = {
    surveyor: { _id: "u-s", role: USER_ROLES.SURVEYOR, status: USER_STATUS.ACTIVE },
    cad: { _id: "u-c", role: USER_ROLES.CAD, status: USER_STATUS.ACTIVE },
    admin: { _id: "u-a", role: USER_ROLES.ADMIN, status: USER_STATUS.ACTIVE },
    disabled: { _id: "u-d", role: USER_ROLES.ADMIN, status: USER_STATUS.DISABLED },
  };

  before(() => {
    origFind = User.findById;
  });
  after(() => {
    User.findById = origFind;
  });

  function eventFor(userKey) {
    const u = users[userKey];
    User.findById = async (id) => (String(id) === String(u._id) ? u : null);
    const token = generateAccessToken(u._id);
    return { headers: { authorization: `Bearer ${token}` } };
  }

  it("surveyor allowed on surveyor route", async () => {
    const { user } = await authorize(USER_ROLES.SURVEYOR)(eventFor("surveyor"));
    assert.equal(user.role, USER_ROLES.SURVEYOR);
  });

  it("surveyor forbidden on admin route", async () => {
    await assert.rejects(
      () => authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(eventFor("surveyor")),
      (err) => err instanceof ForbiddenError
    );
  });

  it("admin allowed on admin route", async () => {
    const { user } = await authorize(USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(eventFor("admin"));
    assert.equal(user.role, USER_ROLES.ADMIN);
  });

  it("cad allowed on cad route, not admin", async () => {
    await authorize(USER_ROLES.CAD, USER_ROLES.ADMIN)(eventFor("cad"));
    await assert.rejects(
      () => authorize(USER_ROLES.ADMIN)(eventFor("cad")),
      (err) => err instanceof ForbiddenError
    );
  });

  it("disabled user unauthorized", async () => {
    await assert.rejects(
      () => authorize(USER_ROLES.ADMIN)(eventFor("disabled")),
      (err) => err instanceof UnauthorizedError
    );
  });

  it("MFA pending token cannot authorize APIs", async () => {
    User.findById = async () => users.admin;
    const token = generateMfaPendingToken(users.admin._id);
    await assert.rejects(
      () => authorize(USER_ROLES.ADMIN)({ headers: { authorization: `Bearer ${token}` } }),
      (err) => err instanceof UnauthorizedError
    );
  });

  it("missing token unauthorized", async () => {
    await assert.rejects(
      () => authorize(USER_ROLES.SURVEYOR)({ headers: {} }),
      (err) => err instanceof UnauthorizedError
    );
  });
});
