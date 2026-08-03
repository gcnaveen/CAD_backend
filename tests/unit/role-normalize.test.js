/**
 * Role / status case normalization + case-insensitive Mongo filters + CAD_USER alias.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeRole,
  normalizeStatus,
  rolesEqual,
  mongoRoleEquals,
  mongoRoleIn,
  mongoStatusEquals,
  roleMatchTokens,
} = require("../../src/utils/roleNormalize");
const { USER_ROLES } = require("../../src/config/constants");

describe("roleNormalize", () => {
  it("normalizes mixed-case roles to canonical uppercase", () => {
    assert.equal(normalizeRole("cad"), USER_ROLES.CAD);
    assert.equal(normalizeRole("Cad"), USER_ROLES.CAD);
    assert.equal(normalizeRole("CAD"), USER_ROLES.CAD);
    assert.equal(normalizeRole("super_admin"), USER_ROLES.SUPER_ADMIN);
    assert.equal(normalizeRole("nope"), null);
  });

  it("maps CAD_USER / cad_user aliases to CAD", () => {
    assert.equal(normalizeRole("CAD_USER"), USER_ROLES.CAD);
    assert.equal(normalizeRole("cad_user"), USER_ROLES.CAD);
    assert.equal(normalizeRole("Cad User"), USER_ROLES.CAD);
    assert.equal(rolesEqual("CAD_USER", USER_ROLES.CAD), true);
    assert.ok(roleMatchTokens(USER_ROLES.CAD).includes("CAD_USER"));
  });

  it("rolesEqual is case-insensitive", () => {
    assert.equal(rolesEqual("cad", "CAD"), true);
    assert.equal(rolesEqual("CAD", "SURVEYOR"), false);
  });

  it("mongoRoleEquals matches any case via anchored regex", () => {
    const f = mongoRoleEquals("cad");
    assert.ok(f.role.$regex instanceof RegExp);
    assert.equal(f.role.$regex.flags.includes("i"), true);
    assert.equal(f.role.$regex.test("CAD"), true);
    assert.equal(f.role.$regex.test("Cad"), true);
    assert.equal(f.role.$regex.test("cad"), true);
    assert.equal(f.role.$regex.test("CAD_USER"), true);
    assert.equal(f.role.$regex.test("CADX"), false);
    assert.equal(f.role.$regex.test("SCAD"), false);
  });

  it("mongoRoleIn matches CAD or SURVEYOR any case (incl CAD_USER)", () => {
    const f = mongoRoleIn([USER_ROLES.CAD, USER_ROLES.SURVEYOR]);
    assert.equal(f.role.$regex.test("cad"), true);
    assert.equal(f.role.$regex.test("CAD_USER"), true);
    assert.equal(f.role.$regex.test("Surveyor"), true);
    assert.equal(f.role.$regex.test("ADMIN"), false);
  });

  it("role=CAD_USER filter resolves via normalizeRole to CAD match", () => {
    assert.equal(normalizeRole("CAD_USER"), USER_ROLES.CAD);
    const f = mongoRoleEquals("CAD_USER");
    assert.equal(f.role.$regex.test("CAD"), true);
    assert.equal(f.role.$regex.test("cad_user"), true);
  });

  it("mongoStatusEquals is case-insensitive", () => {
    const f = mongoStatusEquals("active");
    assert.equal(f.status.$regex.test("ACTIVE"), true);
    assert.equal(f.status.$regex.test("Active"), true);
    assert.equal(normalizeStatus("active"), "ACTIVE");
  });
});
