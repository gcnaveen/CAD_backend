/**
 * User Management Controller
 * Create, get, list, update, delete users (role-based: Super Admin / Admin).
 */

const userService = require("../services/user.service");
const { ok, created } = require("../utils/response");

/**
 * Create a new user (Admin, CAD, or Surveyor).
 */
async function createUser(creator, payload) {
  const result = await userService.createUser(creator, payload);
  return created(result);
}

/**
 * Get user by ID.
 */
async function getById(actor, userId) {
  const result = await userService.getById(actor, userId);
  return ok(result);
}

/**
 * List users with pagination and optional filters.
 */
async function getAll(actor, options) {
  const result = await userService.getAll(actor, options);
  return ok(result);
}

/**
 * Get users by role (pagination and optional status filter).
 */
async function getByRole(actor, role, options) {
  const result = await userService.getByRole(actor, role, options);
  return ok(result);
}

/**
 * Patch user (name, status; CAD: cadCenter; Surveyor: profile).
 */
async function updateUser(actor, userId, payload) {
  const result = await userService.patch(actor, userId, payload);
  return ok(result);
}

/**
 * Soft-delete user by ID.
 */
async function deleteUser(actor, userId) {
  const result = await userService.deleteById(actor, userId);
  return ok(result);
}

/**
 * Block user (set status DISABLED). Super Admin can block any; Admin only CAD/Surveyor. Cannot block self.
 */
async function blockUser(actor, userId) {
  const result = await userService.blockUser(actor, userId);
  return ok(result);
}

/**
 * Unblock user (set status ACTIVE). Same permissions as block.
 */
async function unblockUser(actor, userId) {
  const result = await userService.unblockUser(actor, userId);
  return ok(result);
}

module.exports = {
  createUser,
  getById,
  getAll,
  getByRole,
  updateUser,
  deleteUser,
  blockUser,
  unblockUser,
};
