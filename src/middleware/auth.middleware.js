/**
 * Authentication Middleware – Enterprise
 *
 * - JWT: decode + verify; resolve user from DB (role from DB only, never from token).
 * - 401 Unauthorized: missing/invalid/expired token or user not found/inactive.
 * - 403 Forbidden: valid token but role not allowed for the action.
 */

const jwt = require("jsonwebtoken");
const User = require("../models/user/User");
const { USER_STATUS } = require("../config/constants");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");
const logger = require("../utils/logger");

const JWT_SECRET = process.env.JWT_SECRET || "your-super-secret-jwt-key-change-in-production";

/**
 * Extract Bearer token from request headers
 * @param {Object} event - Lambda event object
 * @returns {string|null} Token or null
 */
const extractToken = (event) => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
};

/**
 * Decode and verify JWT; return payload (no DB). Use for logging or reading claims only.
 * Does not validate user existence or status.
 *
 * @param {string} token
 * @returns {{ userId: string, iat?: number, exp?: number }}
 * @throws {UnauthorizedError}
 */
function decodeToken(token) {
  if (!token) throw new UnauthorizedError("No token provided");
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId || decoded.id;
    if (!userId) throw new UnauthorizedError("Invalid token payload");
    return { ...decoded, userId };
  } catch (err) {
    if (err.name === "TokenExpiredError") throw new UnauthorizedError("Token has expired");
    if (err.name === "JsonWebTokenError") throw new UnauthorizedError("Invalid token");
    throw new UnauthorizedError("Invalid token");
  }
}

/**
 * Authenticate request: verify JWT and load user from DB.
 * Role is always taken from DB (never from JWT) for correct authorization.
 *
 * @param {Object} event - Lambda event
 * @returns {Promise<{ user, decoded }>}
 * @throws {UnauthorizedError}
 */
const authenticate = async (event) => {
  try {
    const token = extractToken(event);
    const decoded = decodeToken(token);

    const user = await User.findById(decoded.userId);
    if (!user) {
      logger.warn("Auth: user not found", { userId: decoded.userId });
      throw new UnauthorizedError("User not found");
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      logger.warn("Auth: user not active", { userId: user._id, status: user.status });
      throw new UnauthorizedError("User account is not active");
    }

    logger.debug("Auth success", { userId: user._id, role: user.role });
    return { user, decoded };
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    logger.debug("Authentication failed", { error: error.message });
    throw new UnauthorizedError(error.message || "Authentication failed");
  }
};

/**
 * Authorize by role list. 403 Forbidden when authenticated but role not allowed.
 *
 * @param {...string} allowedRoles
 * @returns {Function} (event) => Promise<{ user }>
 */
const authorize = (...allowedRoles) => {
  return async (event) => {
    const { user } = await authenticate(event);
    if (!allowedRoles.includes(user.role)) {
      logger.warn("Forbidden: role not allowed", { userId: user._id, role: user.role, allowedRoles });
      throw new ForbiddenError("Insufficient permissions");
    }
    return { user };
  };
};

/**
 * Generate JWT token (payload: userId only; role is resolved from DB on each request).
 *
 * @param {string|Object} userId - User ID or user object with _id
 * @param {string} [expiresIn] - Default from env JWT_EXPIRES_IN or '24h'
 * @returns {string} JWT
 */
const generateToken = (userId, expiresIn) => {
  const id = userId && typeof userId === "object" ? userId._id : userId;
  return jwt.sign(
    { userId: id },
    JWT_SECRET,
    { expiresIn: expiresIn || process.env.JWT_EXPIRES_IN || "24h" }
  );
};

module.exports = {
  extractToken,
  decodeToken,
  authenticate,
  authorize,
  generateToken,
};
