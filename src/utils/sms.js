/**
 * SMS utility – OTP delivery via MSG91 Flow API (v5).
 *
 * Env:
 * - MSG91_AUTHKEY
 * - MSG91_OTP_TEMPLATE_ID  (Flow / template id from MSG91 dashboard)
 * - MSG91_OTP_VARIABLE_NAME (optional, default "number" — must match DLT template ##number##)
 * - MSG91_SMS_ROUTE (optional, default "4")
 * - MSG91_SENDER_ID (optional, e.g. SSMBAS — must match approved DLT sender / flow config)
 *
 * Testing: OTP_TEST_MODE=true or COMMON_OTP skips real SMS (see otp.service.js).
 */

const logger = require("./logger");

const MSG91_FLOW_URL = "https://control.msg91.com/api/v5/flow";

function getMsg91Config() {
  return {
    authKey: String(process.env.MSG91_AUTHKEY || "").trim(),
    templateId: String(process.env.MSG91_OTP_TEMPLATE_ID || "").trim(),
    variableName: String(process.env.MSG91_OTP_VARIABLE_NAME || "number").trim() || "number",
    smsRoute: String(process.env.MSG91_SMS_ROUTE || "4").trim() || "4",
    senderId: String(process.env.MSG91_SENDER_ID || "").trim(),
  };
}

function isMsg91Configured() {
  const { authKey, templateId } = getMsg91Config();
  return Boolean(authKey && templateId);
}

/**
 * Normalize Indian mobile for MSG91 (91 + 10-digit MSISDN).
 * @param {string} phone
 * @returns {string|null}
 */
function normalizeIndianMobile(phone) {
  if (phone == null || phone === "") return null;
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91") && /^91[6-9]/.test(digits)) {
    return digits;
  }
  return null;
}

/**
 * @param {unknown} data
 * @returns {boolean}
 */
function isMsg91SuccessResponse(data) {
  if (data == null || typeof data !== "object") return false;
  const type = String(/** @type {Record<string, unknown>} */ (data).type || "").toLowerCase();
  if (type === "success") return true;
  const message = String(/** @type {Record<string, unknown>} */ (data).message || "").toLowerCase();
  return message.includes("success");
}

/**
 * Send OTP SMS via MSG91 template flow.
 * @param {string} phone
 * @param {string} otp
 * @returns {Promise<boolean>}
 */
async function sendOtpSms(phone, otp) {
  const normalizedMobile = normalizeIndianMobile(phone);
  const otpValue = String(otp || "").trim();

  if (!normalizedMobile) {
    logger.error("MSG91 SMS skipped: invalid Indian mobile number", { phone });
    return false;
  }
  if (!/^\d{4,8}$/.test(otpValue)) {
    logger.error("MSG91 SMS skipped: invalid OTP format", { phone: normalizedMobile });
    return false;
  }

  const { authKey, templateId, variableName, smsRoute, senderId } = getMsg91Config();
  if (!authKey || !templateId) {
    logger.error("MSG91 SMS not configured (set MSG91_AUTHKEY and MSG91_OTP_TEMPLATE_ID)");
    return false;
  }

  const recipient = {
    mobiles: normalizedMobile,
    [variableName]: otpValue,
  };

  const payload = {
    template_id: templateId,
    short_url: "0",
    realTimeResponse: "1",
    smsroute: smsRoute,
    recipients: [recipient],
  };
  if (senderId) {
    payload.sender = senderId;
  }

  try {
    const response = await fetch(MSG91_FLOW_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: authKey,
      },
      body: JSON.stringify(payload),
    });

    let data = null;
    const rawText = await response.text();
    if (rawText) {
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { message: rawText };
      }
    }

    if (!response.ok) {
      logger.error("MSG91 SMS API HTTP error", {
        status: response.status,
        phone: normalizedMobile,
        response: data,
      });
      return false;
    }

    if (!isMsg91SuccessResponse(data)) {
      logger.error("MSG91 SMS API returned failure", {
        phone: normalizedMobile,
        response: data,
      });
      return false;
    }

    logger.info("MSG91 OTP SMS sent", {
      phone: normalizedMobile,
      templateId,
      variableName,
      senderId: senderId || undefined,
    });
    return true;
  } catch (err) {
    logger.error("MSG91 SMS request failed", err, { phone: normalizedMobile });
    return false;
  }
}

module.exports = {
  sendOtpSms,
  isMsg91Configured,
  normalizeIndianMobile,
};
