/**
 * OTP Service
 * Handles OTP generation, storage, verification, and delivery to phone.
 *
 * Audit H-02: crypto.randomInt for OTP; test/common OTP forbidden in production.
 */

const crypto = require("crypto");
const User = require("../models/user/User");
const { sendOtpSms, isMsg91Configured } = require("../utils/sms");
const { UnauthorizedError, BadRequestError, DatabaseError, TooManyRequestsError } = require("../utils/errors");
const logger = require("../utils/logger");
const { isProductionRuntime } = require("../config/authSecurity");
const authThrottle = require("./authThrottle.service");

const OTP_EXPIRY_MINUTES = 10;

function assertOtpTestModeAllowed() {
  const testMode = String(process.env.OTP_TEST_MODE || "").toLowerCase() === "true";
  const common = String(process.env.COMMON_OTP || "").trim();
  if (isProductionRuntime() && (testMode || common)) {
    throw new DatabaseError("OTP test mode is not allowed in production", {
      code: "OTP_TEST_MODE_FORBIDDEN",
    });
  }
}

function isOtpTestModeEnabled() {
  assertOtpTestModeAllowed();
  if (String(process.env.OTP_TEST_MODE || "").toLowerCase() === "true") return true;
  if (String(process.env.COMMON_OTP || "").trim()) return true;
  return false;
}

function getTestOtpValue() {
  assertOtpTestModeAllowed();
  const common = String(process.env.COMMON_OTP || "").trim();
  if (common) return common;
  if (String(process.env.OTP_TEST_MODE || "").toLowerCase() === "true") return "123456";
  return null;
}

/** Cryptographically secure 6-digit OTP (audit H-02). */
function generateOtp() {
  const test = getTestOtpValue();
  if (test) return String(test);
  return String(crypto.randomInt(100000, 1000000));
}

class OtpService {
  /**
   * @param {string} phone
   * @param {Object} [userInstance]
   * @param {{ ip?: string }} [meta]
   */
  async issueOtp(phone, userInstance = null, meta = {}) {
    try {
      assertOtpTestModeAllowed();
      if (!phone || !String(phone).trim()) {
        throw new BadRequestError("Phone number is required");
      }

      const normalizedPhone = String(phone).trim();
      await authThrottle.assertOtpIssueAllowed({ phone: normalizedPhone, ip: meta.ip });

      let user = userInstance;

      if (!user) {
        user = await User.findOne({ "auth.phone": normalizedPhone }).select(
          "+auth.otpCode +auth.otpExpires"
        );

        if (!user) {
          throw new UnauthorizedError("No user found with this phone number");
        }
      } else {
        if (user._id) {
          user = await User.findById(user._id).select("+auth.otpCode +auth.otpExpires");
          if (!user) {
            throw new UnauthorizedError("User not found");
          }
        } else {
          throw new BadRequestError("Invalid user instance provided");
        }
      }

      if (!user.auth) {
        throw new BadRequestError("User auth object is missing");
      }

      const otp = generateOtp();
      const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      user.auth.otpCode = otp;
      user.auth.otpExpires = expires;
      user.auth.otpVerified = false;
      await user.save();

      if (isOtpTestModeEnabled()) {
        logger.info("OTP issued (test mode – SMS skipped)", {
          userId: user._id?.toString(),
          phone: normalizedPhone,
        });
      } else {
        if (!isMsg91Configured()) {
          throw new DatabaseError("SMS gateway is not configured (set MSG91_AUTHKEY and MSG91_OTP_TEMPLATE_ID)", {
            code: "SMS_NOT_CONFIGURED",
          });
        }
        const sent = await sendOtpSms(normalizedPhone, otp);
        if (!sent) {
          throw new DatabaseError("Failed to send OTP via SMS", { code: "SMS_SEND_FAILED" });
        }
        logger.info("OTP issued", { userId: user._id?.toString(), phone: normalizedPhone });
      }
      return { message: "OTP sent to phone", expiresAt: expires };
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        error instanceof BadRequestError ||
        error instanceof DatabaseError ||
        error instanceof TooManyRequestsError
      ) {
        throw error;
      }
      logger.error("Error issuing OTP", error, { phone });
      throw new DatabaseError("Failed to issue OTP", error);
    }
  }

  /**
   * @param {string} phone
   * @param {string} otp
   * @param {{ ip?: string }} [meta]
   */
  async verifyOtp(phone, otp, meta = {}) {
    try {
      assertOtpTestModeAllowed();
      if (!phone || !String(phone).trim()) {
        throw new BadRequestError("Phone number is required");
      }
      if (!otp || !String(otp).trim()) {
        throw new BadRequestError("OTP is required");
      }

      const normalizedPhone = String(phone).trim();
      const throttleKey = await authThrottle.assertOtpVerifyAllowed({
        phone: normalizedPhone,
        ip: meta.ip,
      });

      const user = await User.findOne({ "auth.phone": normalizedPhone }).select(
        "+auth.otpCode +auth.otpExpires"
      );

      if (!user) {
        throw new UnauthorizedError("No user found with this phone number");
      }

      if (!user.auth.otpCode || !user.auth.otpExpires) {
        throw new UnauthorizedError("OTP not requested");
      }

      if (new Date() > user.auth.otpExpires) {
        throw new UnauthorizedError("OTP expired");
      }

      if (user.auth.otpCode !== String(otp).trim()) {
        await authThrottle.recordOtpVerifyFailure(throttleKey);
        throw new UnauthorizedError("Invalid OTP");
      }

      user.auth.otpVerified = true;
      user.auth.otpCode = undefined;
      user.auth.otpExpires = undefined;
      await user.save();
      await authThrottle.recordOtpVerifySuccess(throttleKey);

      logger.info("OTP verified", { userId: user._id?.toString(), phone: normalizedPhone });
      return user;
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        error instanceof BadRequestError ||
        error instanceof TooManyRequestsError
      ) {
        throw error;
      }
      logger.error("Error verifying OTP", error, { phone });
      throw new DatabaseError("Failed to verify OTP", error);
    }
  }
}

module.exports = new OtpService();
module.exports.assertOtpTestModeAllowed = assertOtpTestModeAllowed;
module.exports.generateOtp = generateOtp;
