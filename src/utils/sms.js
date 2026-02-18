/**
 * SMS utility – OTP delivery to phone.
 * Replace with real provider (MSG91, Twilio, etc.) in production.
 */

const logger = require("./logger");

/**
 * Send OTP to phone number.
 * @param {string} phone - Phone number
 * @param {string} otp - OTP code
 * @returns {Promise<boolean>} True if sent (or stubbed) successfully
 */
async function sendOtpSms(phone, otp) {
  try {
    // TODO: integrate SMS gateway (MSG91, Twilio, etc.)
    logger.info("SMS OTP sent (stub)", { phone, otpLength: otp?.length });
    return true;
  } catch (err) {
    logger.error("Failed to send SMS OTP", err, { phone });
    return false;
  }
}

module.exports = {
  sendOtpSms,
};
