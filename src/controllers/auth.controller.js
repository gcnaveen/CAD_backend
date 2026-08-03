const authService = require("../services/auth.service");
const { ok, created } = require("../utils/response");
const authCookies = require("../utils/authCookies");

function withSessionCookies(response, sessionLike) {
  if (!sessionLike || (!sessionLike.refreshToken && !sessionLike.accessToken)) {
    return response;
  }
  return authCookies.attachSessionCookies(response, sessionLike);
}

async function registerSuperAdmin(payload, requestMeta) {
  const result = await authService.registerSuperAdmin(payload, requestMeta);
  return withSessionCookies(created(result), result);
}

async function surveyorSendOtp(payload, requestMeta) {
  const result = await authService.surveyorSendOtp(payload, requestMeta);
  return ok(result);
}

async function surveyorVerifyOtp(payload, requestMeta) {
  const result = await authService.surveyorVerifyOtp(payload, requestMeta);
  return ok(result);
}

async function surveyorCompleteRegistration(payload, requestMeta) {
  const result = await authService.surveyorCompleteRegistration(payload, requestMeta);
  return withSessionCookies(created(result), result);
}

async function surveyorForgotPasswordStart(payload, requestMeta) {
  const result = await authService.surveyorForgotPasswordStart(payload, requestMeta);
  return ok(result);
}

async function surveyorForgotPasswordReset(payload, requestMeta) {
  const result = await authService.surveyorForgotPasswordReset(payload, requestMeta);
  return withSessionCookies(ok(result), result);
}

async function login(payload, requestMeta) {
  const result = await authService.login(payload, requestMeta);
  return withSessionCookies(ok(result), result);
}

async function getMe(actor) {
  const result = await authService.getMe(actor);
  return ok(result);
}

async function refresh(payload, requestMeta) {
  const result = await authService.refreshSession(payload, requestMeta);
  return withSessionCookies(ok(result), result);
}

async function listSessions(actor, requestMeta, currentRefreshToken) {
  const result = await authService.listSessions(actor, requestMeta, currentRefreshToken);
  return ok(result);
}

async function revokeSession(actor, sessionId) {
  const result = await authService.revokeSession(actor, sessionId);
  return ok(result);
}

async function logout(payload, actor) {
  const result = await authService.logout(payload, actor);
  return authCookies.clearSessionCookies(ok(result));
}

async function verifyMfa(payload, requestMeta) {
  const result = await authService.verifyMfa(payload, requestMeta);
  return withSessionCookies(ok(result), result);
}

async function setupMfa(actor) {
  const result = await authService.setupMfa(actor);
  return ok(result);
}

async function enableMfa(actor, payload) {
  const result = await authService.enableMfa(actor, payload);
  return ok(result);
}

module.exports = {
  registerSuperAdmin,
  surveyorSendOtp,
  surveyorVerifyOtp,
  surveyorCompleteRegistration,
  surveyorForgotPasswordStart,
  surveyorForgotPasswordReset,
  login,
  getMe,
  refresh,
  listSessions,
  revokeSession,
  logout,
  verifyMfa,
  setupMfa,
  enableMfa,
};
