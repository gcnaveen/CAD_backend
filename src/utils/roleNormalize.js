/**
 * Canonical uppercase roles/statuses + case-insensitive Mongo match helpers.
 * Prevents CAD (etc.) from disappearing when legacy rows stored mixed-case roles.
 * CAD_USER / cad_user aliases map to canonical CAD (FE treats both as operators).
 */

const { USER_ROLES, USER_STATUS } = require("../config/constants");

/** Non-canonical labels that must resolve to a USER_ROLES value. */
const ROLE_ALIASES = Object.freeze({
  CAD_USER: USER_ROLES.CAD,
  CADUSER: USER_ROLES.CAD,
});

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function canonicalizeRoleToken(role) {
  return String(role)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * All spellings that should match a canonical role in Mongo (case-insensitive).
 * @param {string} canonical
 * @returns {string[]}
 */
function roleMatchTokens(canonical) {
  const c = canonicalizeRoleToken(canonical);
  if (c === USER_ROLES.CAD) return [USER_ROLES.CAD, "CAD_USER", "CADUSER"];
  return [c];
}

/** @returns {string|null} */
function normalizeRole(role) {
  if (role == null || role === "") return null;
  const r = canonicalizeRoleToken(role);
  if (ROLE_ALIASES[r]) return ROLE_ALIASES[r];
  return Object.values(USER_ROLES).includes(r) ? r : null;
}

/** @returns {string|null} */
function normalizeStatus(status) {
  if (status == null || status === "") return null;
  const s = String(status).trim().toUpperCase();
  return Object.values(USER_STATUS).includes(s) ? s : null;
}

function rolesEqual(a, b) {
  const left = normalizeRole(a) || (a == null ? null : canonicalizeRoleToken(a));
  const right = normalizeRole(b) || (b == null ? null : canonicalizeRoleToken(b));
  return Boolean(left) && left === right;
}

/**
 * Case-insensitive equality on `role` field (uses index-friendly regex anchored match).
 * Matches CAD aliases (CAD_USER) when filtering for CAD.
 * @param {string} role canonical or any case
 */
function mongoRoleEquals(role) {
  const r = normalizeRole(role) || canonicalizeRoleToken(role);
  const tokens = roleMatchTokens(r);
  if (tokens.length === 1) {
    return { role: { $regex: new RegExp(`^${escapeRegex(tokens[0])}$`, "i") } };
  }
  const alternation = tokens.map(escapeRegex).join("|");
  return { role: { $regex: new RegExp(`^(?:${alternation})$`, "i") } };
}

/**
 * Case-insensitive membership on `role`.
 * @param {string[]} roles
 */
function mongoRoleIn(roles) {
  const list = [
    ...new Set(
      (roles || [])
        .map((r) => normalizeRole(r) || canonicalizeRoleToken(r))
        .filter(Boolean)
        .flatMap((r) => roleMatchTokens(r))
    ),
  ];
  if (list.length === 0) {
    return { role: { $in: [] } };
  }
  if (list.length === 1) {
    return { role: { $regex: new RegExp(`^${escapeRegex(list[0])}$`, "i") } };
  }
  const alternation = list.map(escapeRegex).join("|");
  return { role: { $regex: new RegExp(`^(?:${alternation})$`, "i") } };
}

/**
 * Case-insensitive equality on `status`.
 * @param {string} status
 */
function mongoStatusEquals(status) {
  const s = normalizeStatus(status) || String(status).trim().toUpperCase();
  return { status: { $regex: new RegExp(`^${escapeRegex(s)}$`, "i") } };
}

module.exports = {
  ROLE_ALIASES,
  normalizeRole,
  normalizeStatus,
  rolesEqual,
  roleMatchTokens,
  mongoRoleEquals,
  mongoRoleIn,
  mongoStatusEquals,
  escapeRegex,
};
