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
    case "GET /api/health":
      return authHandler.getHealth(event);

    case "GET /api/payments/phonepe/callback":
      return authHandler.phonePeSketchCallback(event);

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
    case "POST /api/auth/refresh":
      return authHandler.refreshSession(event);
    case "GET /api/auth/sessions":
      return authHandler.listSessions(event);
    case "DELETE /api/auth/sessions/{sessionId}":
      return authHandler.revokeSession(event);
    case "POST /api/auth/logout":
      return authHandler.logout(event);
    case "POST /api/auth/mfa/verify":
      return authHandler.verifyMfa(event);
    case "POST /api/auth/mfa/setup":
      return authHandler.setupMfa(event);
    case "POST /api/auth/mfa/enable":
      return authHandler.enableMfa(event);

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

    case "GET /api/surveyor/sketch-pricing":
      return authHandler.getSurveyorSketchPricing(event);
    case "POST /api/surveyor/sketch-uploads":
      return authHandler.createSurveyorSketchUpload(event);
    case "POST /api/surveyor/sketch-uploads/{uploadId}/retry-payment":
      return authHandler.retrySurveyorSketchPayment(event);
    case "POST /api/surveyor/sketch-uploads/{uploadId}/clear":
      return authHandler.clearSurveyorSketchUpload(event);
    case "POST /api/surveyor/sketch-uploads/{uploadId}/balance-payment":
      return authHandler.initiateSurveyorBalancePayment(event);
    case "GET /api/surveyor/sketch-uploads/{uploadId}/cad-download":
      return authHandler.getSurveyorCadDownload(event);
    case "POST /api/admin/sketch-uploads/{uploadId}/balance-refund":
      return authHandler.adminMarkBalanceRefunded(event);
    case "GET /api/surveyor/sketch-uploads":
      return authHandler.listSurveyorSketchUploads(event);
    case "GET /api/surveyor/orders":
      return authHandler.listSurveyorOrders(event);
    case "GET /api/surveyor/sketch-uploads/{uploadId}":
      return authHandler.getSurveyorSketchUpload(event);
    case "POST /api/surveyor/sketch-uploads/{uploadId}/revision-request":
      return authHandler.requestSketchRevision(event);
    case "POST /api/surveyor/assignments/{assignmentId}/feedback":
      return authHandler.createCadUserFeedback(event);
    case "GET /api/surveyor/assignments/{assignmentId}/feedback":
      return authHandler.getCadUserFeedback(event);
    case "POST /api/surveyor/sketch-drafts":
      return authHandler.createSurveyDraft(event);
    case "GET /api/surveyor/sketch-drafts":
      return authHandler.listSurveyDrafts(event);
    case "GET /api/admin/survey-draft-reports":
      return authHandler.listAdminSurveyDraftReports(event);
    case "GET /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.getSurveyDraft(event);
    case "PATCH /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.updateSurveyDraft(event);
    case "DELETE /api/surveyor/sketch-drafts/{draftId}":
      return authHandler.deleteSurveyDraft(event);

    case "GET /api/admin/survey-sketch-statuses":
      return authHandler.getSurveySketchStatuses(event);
    case "GET /api/admin/dashboard/stats":
      return authHandler.getAdminDashboardStats(event);
    case "GET /api/admin/ops/observability":
      return authHandler.getAdminOpsObservability(event);
    case "POST /api/admin/survey-sketch-assignments":
      return authHandler.createSurveySketchAssignment(event);
    case "GET /api/admin/survey-sketch-assignments/{assignmentId}":
      return authHandler.getSurveySketchAssignment(event);
    case "PATCH /api/admin/survey-sketch-assignments/{assignmentId}":
      return authHandler.updateSurveySketchAssignment(event);
    case "POST /api/admin/survey-sketch-assignments/{assignmentId}/pullback-reassign":
      return authHandler.pullbackAndReassignSurveySketchAssignment(event);
    case "POST /api/admin/survey-sketch-assignments/{assignmentId}/sla-extend":
      return authHandler.extendAssignmentSla(event);
    case "GET /api/admin/cad-centers/{cadCenterId}/assignments":
      return authHandler.listAssignmentsByCadCenter(event);

    case "GET /api/cad/assignments":
      return authHandler.listCadAssignments(event);
    case "GET /api/cad/dashboard":
      return authHandler.getCadDashboard(event);
    case "GET /api/cad/dashboard/stats":
      return authHandler.getCadDashboardStats(event);
    case "GET /api/cad/dashboard/overview":
      return authHandler.getCadDashboardOverview(event);
    case "GET /api/cad/wallet":
      return authHandler.getCadWalletSummary(event);
    case "GET /api/cad/wallet/transactions":
      return authHandler.listCadWalletTransactions(event);
    case "GET /api/cad/sketch-uploads/{uploadId}":
      return authHandler.getCadSketchUpload(event);
    case "POST /api/cad/assignments/{assignmentId}/accept":
      return authHandler.acceptAssignmentByCad(event);
    case "POST /api/cad/assignments/{assignmentId}/reject":
      return authHandler.rejectAssignmentByCad(event);
    case "POST /api/cad/assignments/{assignmentId}/deliver":
      return authHandler.deliverCadSketch(event);
    case "POST /api/cad/assignments/{assignmentId}/deliver-revision":
      return authHandler.deliverCadSketchRevision(event);
    case "GET /api/admin/survey-sketch-assignment-flow":
      return authHandler.getSurveySketchAssignmentFlow(event);
    case "PATCH /api/admin/survey-sketch-assignment-flow":
      return authHandler.updateSurveySketchAssignmentFlow(event);
    case "GET /api/admin/auto-assign/exceptions":
      return authHandler.listAutoAssignExceptions(event);
    case "POST /api/admin/sketch-uploads/{uploadId}/auto-assign/retry":
      return authHandler.retryAutoAssign(event);
    case "GET /api/admin/sketch-uploads/{uploadId}/auto-assign/attempts":
      return authHandler.getAutoAssignAttempts(event);
    case "GET /api/admin/sketch-uploads/{uploadId}/auto-assign/manual-gate":
      return authHandler.getAutoAssignManualGate(event);
    case "GET /api/admin/survey-sketch-pricing":
      return authHandler.getAdminSurveySketchPricing(event);
    case "PATCH /api/admin/survey-sketch-pricing":
      return authHandler.updateAdminSurveySketchPricing(event);
    case "GET /api/admin/payments/reconciliation":
      return authHandler.getAdminPaymentReconciliation(event);
    case "POST /api/admin/cad-wallet-entries/{entryId}/mark-paid":
      return authHandler.markCadWalletEntryPaid(event);
    case "POST /api/admin/cad-wallet-entries/{entryId}/record-payment":
      return authHandler.recordCadWalletPayment(event);
    case "POST /api/admin/cad-wallet/pay-user":
      return authHandler.recordCadWalletPaymentForUser(event);
    case "GET /api/admin/cad-wallet/pending-summary":
      return authHandler.getAdminCadPendingPayoutSummary(event);
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
