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
    `${(event.requestContext?.http?.method || "").toUpperCase()} ${event.rawPath || event.requestContext?.http?.path || ""}`.trim();

  switch (routeKey) {
    case "POST /api/auth/superadmin/register":
      return authHandler.registerSuperAdmin(event);

    case "POST /api/auth/surveyor/start":
      return authHandler.surveyorSendOtp(event);

    case "POST /api/auth/surveyor/verify-otp":
      return authHandler.surveyorVerifyOtp(event);

    case "POST /api/auth/surveyor/complete":
      return authHandler.surveyorCompleteRegistration(event);

    case "POST /api/auth/surveyor/forgot-password/start":
      return authHandler.surveyorForgotPasswordStart(event);

    case "POST /api/auth/surveyor/forgot-password/reset":
      return authHandler.surveyorForgotPasswordReset(event);

    case "POST /api/auth/login":
      return authHandler.login(event);

    case "POST /api/cad-interest":
      return authHandler.createCadInterest(event);

    case "GET /api/cad-interest":
      return authHandler.listCadInterests(event);

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
    case "POST /api/surveyor/sketch-drafts":
      return authHandler.createSurveyDraft(event);
    case "GET /api/surveyor/sketch-drafts":
      return authHandler.listSurveyDrafts(event);
    case "GET /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.getSurveyDraft(event);
    case "PATCH /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.updateSurveyDraft(event);
    case "DELETE /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.deleteSurveyDraft(event);

    case "GET /api/admin/survey-sketch-statuses":
      return authHandler.getSurveySketchStatuses(event);
    case "POST /api/admin/survey-sketch-assignments":
      return authHandler.createSurveySketchAssignment(event);
    case "GET /api/admin/survey-sketch-assignments/{assignmentId}":
      return authHandler.getSurveySketchAssignment(event);
    case "PATCH /api/admin/survey-sketch-assignments/{assignmentId}":
      return authHandler.updateSurveySketchAssignment(event);
    case "GET /api/admin/cad-centers/{cadCenterId}/assignments":
      return authHandler.listAssignmentsByCadCenter(event);

    case "GET /api/cad/assignments":
      return authHandler.listCadAssignments(event);
    case "GET /api/cad/sketch-uploads/{uploadId}":
      return authHandler.getCadSketchUpload(event);
    case "POST /api/cad/assignments/{assignmentId}/accept":
      return authHandler.acceptAssignmentByCad(event);
    case "POST /api/cad/assignments/{assignmentId}/deliver":
      return authHandler.deliverCadSketch(event);
    case "GET /api/admin/survey-sketch-assignment-flow":
      return authHandler.getSurveySketchAssignmentFlow(event);
    case "PATCH /api/admin/survey-sketch-assignment-flow":
      return authHandler.updateSurveySketchAssignmentFlow(event);
    case "GET /api/notifications":
      return authHandler.listNotifications(event);
    case "GET /api/notifications/{notificationId}":
      return authHandler.getNotification(event);
    case "POST /api/notifications/{notificationId}/read":
      return authHandler.markNotificationRead(event);
    case "POST /api/notifications/read-all":
      return authHandler.markAllNotificationsRead(event);

    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
