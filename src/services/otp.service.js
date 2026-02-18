/**
 * OTP Service
 * Handles OTP generation, storage, verification, and delivery to phone.
 */

const User = require("../models/user/User");
const { sendOtpSms } = require("../utils/sms");
const { UnauthorizedError, BadRequestError, DatabaseError } = require("../utils/errors");
const logger = require("../utils/logger");

const OTP_EXPIRY_MINUTES = 10;

const generateOtp = () => {
  return String(100000 + Math.floor(Math.random() * 900000));
};

class OtpService {
  /**
   * Issue OTP for a phone number. Finds user by auth.phone, sets OTP, sends SMS.
   * @param {string} phone - Phone number
   * @param {Object} [userInstance] - Optional user instance to use instead of finding by phone
   * @returns {Promise<{ message: string, expiresAt: Date }>}
   */
  async issueOtp(phone, userInstance = null) {
    try {
      if (!phone || !String(phone).trim()) {
        throw new BadRequestError("Phone number is required");
      }

      const normalizedPhone = String(phone).trim();
      let user = userInstance;

      // If user instance not provided, find by phone
      if (!user) {
        user = await User.findOne({ "auth.phone": normalizedPhone }).select(
          "+auth.otpCode +auth.otpExpires"
        );

        if (!user) {
          throw new UnauthorizedError("No user found with this phone number");
        }
      } else {
        // If user instance provided, reload with OTP fields to ensure they're accessible
        // (OTP fields are select: false by default)
        if (user._id) {
          user = await User.findById(user._id).select("+auth.otpCode +auth.otpExpires");
          if (!user) {
            throw new UnauthorizedError("User not found");
          }
        } else {
          throw new BadRequestError("Invalid user instance provided");
        }
      }

      // Ensure auth object exists
      if (!user.auth) {
        throw new BadRequestError("User auth object is missing");
      }

      const otp = generateOtp();
      const expires = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

      user.auth.otpCode = otp;
      user.auth.otpExpires = expires;
      user.auth.otpVerified = false;
      await user.save();

      const sent = await sendOtpSms(normalizedPhone, otp);
      if (!sent) {
        throw new DatabaseError("Failed to send OTP");
      }

      logger.info("OTP issued", { userId: user._id?.toString(), phone: normalizedPhone });
      return { message: "OTP sent to phone", expiresAt: expires };
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        error instanceof BadRequestError ||
        error instanceof DatabaseError
      ) {
        throw error;
      }
      logger.error("Error issuing OTP", error, { phone });
      throw new DatabaseError("Failed to issue OTP", error);
    }
  }

  /**
   * Verify OTP for a phone number. Marks user as otpVerified and clears OTP fields.
   * @param {string} phone - Phone number
   * @param {string} otp - OTP code
   * @returns {Promise<import("../models/user/User")>} User document
   */
  async verifyOtp(phone, otp) {
    try {
      if (!phone || !String(phone).trim()) {
        throw new BadRequestError("Phone number is required");
      }
      if (!otp || !String(otp).trim()) {
        throw new BadRequestError("OTP is required");
      }

      const normalizedPhone = String(phone).trim();
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
        throw new UnauthorizedError("Invalid OTP");
      }

      user.auth.otpVerified = true;
      user.auth.otpCode = undefined;
      user.auth.otpExpires = undefined;
      await user.save();

      logger.info("OTP verified", { userId: user._id?.toString(), phone: normalizedPhone });
      return user;
    } catch (error) {
      if (
        error instanceof UnauthorizedError ||
        error instanceof BadRequestError
      ) {
        throw error;
      }
      logger.error("Error verifying OTP", error, { phone });
      throw new DatabaseError("Failed to verify OTP", error);
    }
  }
}

module.exports = new OtpService();
