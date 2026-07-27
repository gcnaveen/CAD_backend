/**
 * Authentication Middleware – Enterprise
 *
 * - JWT access tokens (short-lived); role always from DB.
 * - JWT_SECRET from environment only (H-01).
 * - Access / MFA-pending token helpers (H-02).
 */

const jwt = require("jsonwebtoken");
const User = require("../models/user/User");
const { USER_STATUS } = require("../config/constants");
const { UnauthorizedError, ForbiddenError } = require("../utils/errors");
const logger = require("../utils/logger");
const { getJwtSecret } = require("../config/secrets");
const { ACCESS_TOKEN_EXPIRES_IN, MFA_PENDING_EXPIRES_IN } = require("../config/authSecurity");

const extractToken = (event) => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") return null;
  return parts[1];
};

function decodeToken(token) {
  if (!token) throw new UnauthorizedError("No token provided");
  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const userId = decoded.userId || decoded.id;
    if (!userId) throw new UnauthorizedError("Invalid token payload");
    return { ...decoded, userId };
  } catch (err) {
    if (err instanceof UnauthorizedError) throw err;
    if (err.name === "TokenExpiredError") throw new UnauthorizedError("Token has expired");
    if (err.name === "JsonWebTokenError") throw new UnauthorizedError("Invalid token");
    if (err.message && String(err.message).includes("JWT_SECRET")) {
      logger.error("JWT_SECRET misconfigured", err);
      throw new UnauthorizedError("Authentication service misconfigured");
    }
    throw new UnauthorizedError("Invalid token");
  }
}

const authenticate = async (event) => {
  try {
    const token = extractToken(event);
    const decoded = decodeToken(token);
    if (decoded.purpose === "MFA_PENDING") {
      throw new UnauthorizedError("MFA verification required");
    }

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

/** Short-lived access token (H-02). */
const generateAccessToken = (userId, expiresIn) => {
  const id = userId && typeof userId === "object" ? userId._id : userId;
  return jwt.sign(
    { userId: id, typ: "access" },
    getJwtSecret(),
    { expiresIn: expiresIn || ACCESS_TOKEN_EXPIRES_IN }
  );
};

/** @deprecated alias — prefer generateAccessToken */
const generateToken = generateAccessToken;

/** Short-lived MFA challenge token (not usable as API access). */
const generateMfaPendingToken = (userId) => {
  const id = userId && typeof userId === "object" ? userId._id : userId;
  return jwt.sign(
    { userId: id, purpose: "MFA_PENDING" },
    getJwtSecret(),
    { expiresIn: MFA_PENDING_EXPIRES_IN }
  );
};

function verifyMfaPendingToken(token) {
  const decoded = decodeToken(token);
  if (decoded.purpose !== "MFA_PENDING") {
    throw new UnauthorizedError("Invalid MFA token");
  }
  return decoded;
}

module.exports = {
  extractToken,
  decodeToken,
  authenticate,
  authorize,
  generateToken,
  generateAccessToken,
  generateMfaPendingToken,
  verifyMfaPendingToken,
};
