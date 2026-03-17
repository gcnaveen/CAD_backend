const authService = require("../services/auth.service");
const { ok, created } = require("../utils/response");

/**
 * Super Admin registration. Returns { user, token }.
 */
async function registerSuperAdmin(payload) {
  const result = await authService.registerSuperAdmin(payload);
  return created(result);
}

/**
 * Surveyor step 1: send OTP to phone. Body: phone, firstName, lastName?.
 */
async function surveyorSendOtp(payload) {
  const result = await authService.surveyorSendOtp(payload);
  return ok(result);
}

/**
 * Surveyor step 2: verify OTP. Body: phone, otp. Returns { user, message }.
 */
async function surveyorVerifyOtp(payload) {
  const result = await authService.surveyorVerifyOtp(payload);
  return ok(result);
}

/**
 * Surveyor step 3: complete registration - set password and profile. Body: phone, password, district, taluka, category, surveyType?.
 * Returns { user, token }.
 */
async function surveyorCompleteRegistration(payload) {
  const result = await authService.surveyorCompleteRegistration(payload);
  return created(result);
}

/**
 * Login with email + password. Returns { user, token }.
 */
async function login(payload) {
  const result = await authService.login(payload);
  return ok(result);
}

module.exports = {
  registerSuperAdmin,
  surveyorSendOtp,
  surveyorVerifyOtp,
  surveyorCompleteRegistration,
  login,
};
