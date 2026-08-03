/**
 * Authentication Service
 * Super Admin/Admin/CAD: email + password (+ admin MFA).
 * Surveyor: phone + password login (OTP only during first-time registration).
 * Audit H-02: throttling, short access tokens, rotating refresh tokens, MFA for admins.
 */

const User = require("../models/user/User");
const {
  generateAccessToken,
  generateMfaPendingToken,
  verifyMfaPendingToken,
} = require("../middleware/auth.middleware");
const otpService = require("./otp.service");
const authAudit = require("./authAudit.service");
const authThrottle = require("./authThrottle.service");
const refreshTokenService = require("./refreshToken.service");
const totp = require("../utils/totp");
const notificationService = require("./notification.service");
const { USER_ROLES, USER_STATUS } = require("../config/constants");
const { ACCESS_TOKEN_EXPIRES_IN } = require("../config/authSecurity");
const {
  BadRequestError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  DatabaseError,
  TooManyRequestsError,
} = require("../utils/errors");
const logger = require("../utils/logger");
const { normalizeRole, rolesEqual } = require("../utils/roleNormalize");

const EMAIL_PASSWORD_ROLES = [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN, USER_ROLES.CAD];
const SURVEYOR_ROLE = USER_ROLES.SURVEYOR;
const MFA_ROLES = [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN];

async function issueSession(user, requestMeta = {}) {
  const accessToken = generateAccessToken(user);
  const refresh = await refreshTokenService.issueRefreshToken(user._id, requestMeta);
  return {
    token: accessToken,
    accessToken,
    refreshToken: refresh.refreshToken,
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    refreshExpiresAt: refresh.expiresAt,
    sessionId: refresh.sessionId,
  };
}

class AuthService {
  async hasSuperAdmin() {
    const count = await User.countDocuments({ role: USER_ROLES.SUPER_ADMIN });
    return count > 0;
  }

  async registerSuperAdmin(payload, requestMeta = {}) {
    const { firstName, lastName, email, password } = payload;

    if (!email || !password || !firstName) {
      throw new BadRequestError("firstName, email and password are required");
    }

    const existing = await User.findOne({ "auth.email": email.toLowerCase().trim() });
    if (existing) {
      throw new ConflictError("Email already registered");
    }

    const user = await User.create({
      role: USER_ROLES.SUPER_ADMIN,
      name: { first: firstName.trim(), last: (lastName || "").trim() },
      auth: {
        email: email.toLowerCase().trim(),
        password,
      },
      createdBy: null,
    });

    const session = await issueSession(user, requestMeta);
    return {
      user,
      ...session,
      otpRequired: false,
      message: "Registration successful. Enable MFA via POST /api/auth/mfa/setup.",
    };
  }

  async surveyorSendOtp(payload, requestMeta = {}) {
    const { phone, firstName, lastName } = payload;

    if (!phone || !firstName) {
      throw new BadRequestError("phone and firstName are required");
    }

    const normalizedPhone = String(phone).trim();
    let user = await User.findOne({ "auth.phone": normalizedPhone }).select(
      "+auth.otpCode +auth.otpExpires"
    );

    if (!user) {
      try {
        user = await User.create({
          role: USER_ROLES.SURVEYOR,
          name: { first: firstName.trim(), last: (lastName || "").trim() },
          auth: { phone: normalizedPhone },
        });
        user = await User.findById(user._id).select("+auth.otpCode +auth.otpExpires");
      } catch (err) {
        if (err.code === 11000 || err.name === "MongoServerError") {
          user = await User.findOne({ "auth.phone": normalizedPhone }).select(
            "+auth.otpCode +auth.otpExpires"
          );
          if (!user) {
            throw new DatabaseError("Failed to create user", err);
          }
        } else {
          throw err;
        }
      }
    } else {
      if (user.role !== USER_ROLES.SURVEYOR) {
        throw new ConflictError("This phone is registered with a different role");
      }
      user.name.first = firstName.trim();
      user.name.last = (lastName || "").trim();
      await user.save();
    }

    if (!user._id) {
      throw new DatabaseError("User not properly saved");
    }

    const result = await otpService.issueOtp(normalizedPhone, user, { ip: requestMeta.ip });
    return {
      message: result.message,
      expiresAt: result.expiresAt,
      otpRequired: true,
    };
  }

  async surveyorVerifyOtp(payload, requestMeta = {}) {
    const { phone, otp } = payload;

    if (!phone || !otp) {
      throw new BadRequestError("phone and otp are required");
    }

    const user = await otpService.verifyOtp(String(phone).trim(), String(otp).trim(), {
      ip: requestMeta.ip,
    });

    if (user.role !== USER_ROLES.SURVEYOR) {
      throw new BadRequestError("User is not a surveyor");
    }

    if (user.status !== USER_STATUS.ACTIVE) {
      user.status = USER_STATUS.ACTIVE;
      await user.save();
    }

    return {
      user,
      message: "OTP verified. Please complete registration with password and profile details.",
    };
  }

  async surveyorCompleteRegistration(payload, requestMeta = {}) {
    const { phone, password, district, taluka, category, surveyType, firstName, lastName } = payload;

    if (!phone || !password) {
      throw new BadRequestError("phone and password are required");
    }

    if (!district || !taluka || !category) {
      throw new BadRequestError("district, taluka and category are required");
    }

    if (category === "SURVEYOR" && !surveyType) {
      throw new BadRequestError("surveyType (LS or GS) is required when category is SURVEYOR");
    }

    const normalizedPhone = String(phone).trim();
    const user = await User.findOne({ "auth.phone": normalizedPhone }).select("+auth.password");

    if (!user) {
      throw new NotFoundError("User not found");
    }

    if (user.role !== USER_ROLES.SURVEYOR) {
      throw new BadRequestError("User is not a surveyor");
    }

    if (!user.auth?.otpVerified) {
      throw new ForbiddenError("Complete OTP verification before completing registration");
    }

    if (user.auth.password) {
      throw new ConflictError("Registration already completed. Use login instead.");
    }

    if (firstName) {
      user.name.first = firstName.trim();
    }
    if (lastName !== undefined) {
      user.name.last = lastName ? lastName.trim() : "";
    }

    user.auth.password = password;
    user.surveyorProfile = {
      district,
      taluka,
      category,
      surveyType: category === "SURVEYOR" ? surveyType : undefined,
    };

    await user.save();

    const session = await issueSession(user, requestMeta);
    return {
      user,
      ...session,
      message: "Registration completed successfully.",
    };
  }

  async surveyorForgotPasswordStart(payload, requestMeta = {}) {
    const { phone } = payload;
    if (!phone) {
      throw new BadRequestError("phone is required");
    }

    const normalizedPhone = String(phone).trim();

    const user = await User.findOne({ "auth.phone": normalizedPhone }).select("role status");
    if (!user) {
      throw new UnauthorizedError("No user found with this phone number");
    }
    if (user.role !== SURVEYOR_ROLE) {
      throw new BadRequestError("This account does not use surveyor OTP login");
    }
    if (user.status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedError("User account is not active");
    }

    const result = await otpService.issueOtp(normalizedPhone, user, { ip: requestMeta.ip });
    return { ...result, otpRequired: true };
  }

  async surveyorForgotPasswordReset(payload, requestMeta = {}) {
    const { phone, otp, password } = payload;

    const normalizedPhone = String(phone).trim();
    const verifiedUser = await otpService.verifyOtp(normalizedPhone, String(otp).trim(), {
      ip: requestMeta.ip,
    });

    if (verifiedUser.role !== SURVEYOR_ROLE) {
      throw new BadRequestError("User is not a surveyor");
    }
    if (verifiedUser.status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedError("User account is not active");
    }

    verifiedUser.auth.password = password;
    await verifiedUser.save();
    await refreshTokenService.revokeAllForUser(verifiedUser._id);

    const session = await issueSession(verifiedUser, requestMeta);
    return {
      user: verifiedUser,
      ...session,
      message: "Password reset successful",
      otpRequired: false,
    };
  }

  async login(payload, requestMeta = {}) {
    const { email, phone, password } = payload;
    const identifier = email ? String(email).toLowerCase().trim() : phone ? String(phone).trim() : null;

    if (!password) {
      throw new BadRequestError("password is required");
    }

    if (!email && !phone) {
      throw new BadRequestError("email or phone is required");
    }

    const throttleKey = await authThrottle.assertLoginAllowed({
      ip: requestMeta.ip,
      identifier,
    });

    let user;

    try {
      if (email) {
        user = await User.findOne({ "auth.email": email.toLowerCase().trim() }).select(
          "+auth.password +auth.mfaSecret"
        );

        if (!user) {
          throw new UnauthorizedError("Invalid credentials");
        }

        if (!EMAIL_PASSWORD_ROLES.some((r) => rolesEqual(user.role, r))) {
          throw new BadRequestError(
            "This account uses phone + password login. Use phone number and password to sign in."
          );
        }
      } else {
        const normalizedPhone = String(phone).trim();
        user = await User.findOne({ "auth.phone": normalizedPhone }).select(
          "+auth.password +auth.mfaSecret"
        );

        if (!user) {
          throw new UnauthorizedError("Invalid credentials");
        }

        if (!rolesEqual(user.role, SURVEYOR_ROLE)) {
          throw new BadRequestError(
            "This account uses email + password login. Use email and password to sign in."
          );
        }

        if (!user.auth.password) {
          throw new BadRequestError(
            "Password not set. Complete registration by setting your password."
          );
        }
      }

      if (user.status !== USER_STATUS.ACTIVE) {
        throw new UnauthorizedError("User account is not active");
      }

      const match = await user.comparePassword(password);
      if (!match) {
        throw new UnauthorizedError("Invalid credentials");
      }

      await authThrottle.recordLoginSuccess(throttleKey);

      // Admin MFA gate
      if (MFA_ROLES.some((r) => rolesEqual(user.role, r)) && user.auth?.mfaEnabled) {
        const mfaToken = generateMfaPendingToken(user);
        await authAudit.recordLoginEvent({
          success: true,
          user,
          identifier,
          reason: "MFA_REQUIRED",
          requestMeta,
        });
        return {
          user: null,
          mfaRequired: true,
          mfaToken,
          message: "MFA required. Submit code to POST /api/auth/mfa/verify",
        };
      }

      await this._finalizeLogin(user, identifier, requestMeta);
      const session = await issueSession(user, requestMeta);
      return {
        user,
        ...session,
        mfaRequired: false,
        otpRequired: false,
        message: "Login successful",
      };
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        try {
          await authThrottle.recordLoginFailure(throttleKey);
        } catch (lockErr) {
          if (lockErr instanceof TooManyRequestsError) throw lockErr;
        }
        await authAudit.recordLoginEvent({
          success: false,
          user: user || null,
          identifier,
          reason: "INVALID_CREDENTIALS",
          requestMeta,
        });
      }
      throw err;
    }
  }

  async _finalizeLogin(user, identifier, requestMeta) {
    const prevIp = user.auth?.lastLoginIp || null;
    const newIp = requestMeta.ip || null;
    user.auth.lastLoginAt = new Date();
    user.auth.lastLoginIp = newIp;
    await user.save();

    await authAudit.recordLoginEvent({
      success: true,
      user,
      identifier,
      requestMeta,
    });

    if (prevIp && newIp && prevIp !== newIp && MFA_ROLES.some((r) => rolesEqual(user.role, r))) {
      try {
        await notificationService.create({
          type: "SUSPICIOUS_LOGIN",
          title: "Suspicious login",
          message: `Login from new IP ${newIp} (previous ${prevIp})`,
          entityType: "User",
          entityId: user._id,
          targetRoles: [USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN],
          targetUsers: [user._id],
          createdBy: user._id,
          data: { ip: newIp, previousIp: prevIp },
        });
      } catch (err) {
        logger.error("Failed to create suspicious login notification", err);
      }
    }
  }

  async verifyMfa({ mfaToken, code }, requestMeta = {}) {
    if (!mfaToken || !code) {
      throw new BadRequestError("mfaToken and code are required");
    }
    const decoded = verifyMfaPendingToken(mfaToken);
    const user = await User.findById(decoded.userId).select("+auth.mfaSecret");
    if (!user || !user.auth?.mfaEnabled || !user.auth?.mfaSecret) {
      throw new UnauthorizedError("MFA not configured");
    }
    if (!totp.verifyTotp(user.auth.mfaSecret, code)) {
      throw new UnauthorizedError("Invalid MFA code");
    }
    const identifier = user.auth.email || user.auth.phone;
    await this._finalizeLogin(user, identifier, requestMeta);
    const session = await issueSession(user, requestMeta);
    return {
      user,
      ...session,
      mfaRequired: false,
      message: "MFA verified",
    };
  }

  async setupMfa(actor) {
    if (!MFA_ROLES.includes(actor.role)) {
      throw new ForbiddenError("MFA setup is for Admin / Super Admin only");
    }
    const user = await User.findById(actor._id).select("+auth.mfaSecret");
    if (!user) throw new NotFoundError("User not found");
    const secret = totp.generateMfaSecret();
    user.auth.mfaSecret = secret;
    user.auth.mfaEnabled = false;
    await user.save();
    return {
      secret,
      otpauthUrl: totp.otpauthUrl({
        secret,
        email: user.auth.email,
        issuer: "CAD Backend",
      }),
      message: "Scan otpauthUrl in authenticator app, then POST /api/auth/mfa/enable with a code",
    };
  }

  async enableMfa(actor, { code }) {
    if (!MFA_ROLES.includes(actor.role)) {
      throw new ForbiddenError("MFA enable is for Admin / Super Admin only");
    }
    if (!code) throw new BadRequestError("code is required");
    const user = await User.findById(actor._id).select("+auth.mfaSecret");
    if (!user?.auth?.mfaSecret) {
      throw new BadRequestError("Call /api/auth/mfa/setup first", { code: "MFA_SETUP_REQUIRED" });
    }
    if (!totp.verifyTotp(user.auth.mfaSecret, code)) {
      throw new UnauthorizedError("Invalid MFA code");
    }
    user.auth.mfaEnabled = true;
    await user.save();
    return { mfaEnabled: true, message: "MFA enabled" };
  }

  async refreshSession({ refreshToken }, requestMeta = {}) {
    if (!refreshToken) {
      throw new UnauthorizedError("Invalid or expired refresh token", {
        code: "REFRESH_TOKEN_MISSING",
      });
    }
    const rotated = await refreshTokenService.rotateRefreshToken(refreshToken, requestMeta);
    if (!rotated.ok) {
      throw new UnauthorizedError("Invalid or expired refresh token", {
        code: rotated.reason || "INVALID_REFRESH",
      });
    }
    const user = await User.findById(rotated.userId);
    if (!user || user.status !== USER_STATUS.ACTIVE) {
      throw new UnauthorizedError("User not found or inactive");
    }
    const accessToken = generateAccessToken(user);
    return {
      token: accessToken,
      accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      refreshExpiresAt: rotated.expiresAt,
      sessionId: rotated.sessionId || null,
    };
  }

  async listSessions(actor, requestMeta = {}, currentRefreshToken = null) {
    if (!actor?._id) throw new UnauthorizedError("Authentication required");
    const sessions = await refreshTokenService.listSessionsForUser(actor._id, {
      currentRawToken: currentRefreshToken,
    });
    return {
      sessions,
      maxSessions: refreshTokenService.getMaxSessionsPerUser(),
      accessTokenTtl: ACCESS_TOKEN_EXPIRES_IN,
      refreshTtlMs: require("../config/authSecurity").REFRESH_TOKEN_TTL_MS,
    };
  }

  async revokeSession(actor, sessionId) {
    if (!actor?._id) throw new UnauthorizedError("Authentication required");
    if (!sessionId) throw new BadRequestError("sessionId is required");
    const result = await refreshTokenService.revokeSessionById(actor._id, sessionId);
    if (!result.ok && result.reason === "NOT_FOUND") {
      throw new NotFoundError("Session not found", { code: "SESSION_NOT_FOUND" });
    }
    return { message: "Session revoked", sessionId: String(sessionId) };
  }

  async logout({ refreshToken, allSessions = false } = {}, actor = null) {
    if (allSessions && actor?._id) {
      await refreshTokenService.revokeAllForUser(actor._id, "LOGOUT_ALL");
      return { message: "Logged out of all sessions", revokedAll: true };
    }
    if (refreshToken) {
      await refreshTokenService.revokeRefreshToken(refreshToken, "LOGOUT");
      return { message: "Logged out" };
    }
    if (actor?._id) {
      await refreshTokenService.revokeAllForUser(actor._id, "LOGOUT_ALL");
      return { message: "Logged out of all sessions", revokedAll: true };
    }
    return { message: "Logged out" };
  }

  /**
   * Current authenticated user (FE session restore after refresh).
   * Role is canonicalized for case / CAD_USER aliases.
   */
  async getMe(actor) {
    if (!actor?._id) throw new UnauthorizedError("Authentication required");
    const user = await User.findById(actor._id);
    if (!user || user.deletedAt) {
      throw new UnauthorizedError("User not found or inactive");
    }
    if (!rolesEqual(user.status, USER_STATUS.ACTIVE)) {
      throw new UnauthorizedError("User account is not active");
    }
    const role = normalizeRole(user.role) || String(user.role || "").toUpperCase();
    const lean = user.toObject ? user.toObject() : { ...user };
    if (lean.auth) {
      delete lean.auth.password;
      delete lean.auth.mfaSecret;
    }
    lean.role = role;
    return { user: lean, role };
  }

  async resendSurveyorOtp(phone, requestMeta = {}) {
    const normalizedPhone = String(phone).trim();
    const user = await User.findOne({ "auth.phone": normalizedPhone }).select("+auth.password");

    if (!user) {
      throw new UnauthorizedError("No user found with this phone number");
    }

    if (user.role !== SURVEYOR_ROLE) {
      throw new BadRequestError(
        "This account uses email + password login. Use email and password to sign in."
      );
    }

    if (user.auth.password) {
      throw new BadRequestError(
        "Password already set. Use phone and password to login instead."
      );
    }

    return otpService.issueOtp(normalizedPhone, user, { ip: requestMeta.ip });
  }
}

module.exports = new AuthService();
