/**
 * Auth API Router (Single Lambda)
 * Role-based: Super Admin registration, Surveyor (start → verify OTP → complete registration), Login.
 */

const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");
const authHandler = require("./auth.handler");

exports.handler = asyncHandler(async (event) => {
  const routeKey =
    event.routeKey ||
    `${(event.requestContext?.http?.method || "").toUpperCase()} ${event.requestContext?.http?.path || ""}`.trim();

  switch (routeKey) {
    case "POST /api/auth/superadmin/register":
      return authHandler.registerSuperAdmin(event);

    case "POST /api/auth/surveyor/start":
      return authHandler.surveyorSendOtp(event);

    case "POST /api/auth/surveyor/verify-otp":
      return authHandler.surveyorVerifyOtp(event);

    case "POST /api/auth/surveyor/complete":
      return authHandler.surveyorCompleteRegistration(event);

    case "POST /api/auth/login":
      return authHandler.login(event);

    case "POST /api/users":
      return authHandler.createUser(event);
    case "GET /api/users":
      return authHandler.listUsers(event);
    case "GET /api/users/role/{role}":
      return authHandler.getUsersByRole(event);
    case "GET /api/users/{userId}":
      return authHandler.getUser(event);
    case "PATCH /api/users/{userId}":
      return authHandler.updateUser(event);
    case "DELETE /api/users/{userId}":
      return authHandler.deleteUser(event);
    case "POST /api/users/{userId}/block":
      return authHandler.blockUser(event);
    case "POST /api/users/{userId}/unblock":
      return authHandler.unblockUser(event);

    case "POST /api/surveyor/sketch-uploads":
      return authHandler.createSurveyorSketchUpload(event);
    case "GET /api/surveyor/sketch-uploads":
      return authHandler.listSurveyorSketchUploads(event);
    case "GET /api/surveyor/sketch-uploads/{uploadId}":
      return authHandler.getSurveyorSketchUpload(event);

    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
