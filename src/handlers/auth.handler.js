const { connectDB, mongoose } = require("../config/db");
const authController = require("../controllers/auth.controller");
const userController = require("../controllers/user.controller");
const surveyorSketchUploadController = require("../controllers/surveyorSketchUpload.controller");
const surveyDraftController = require("../controllers/surveyDraft.controller");
const surveySketchAssignmentController = require("../controllers/assignment/surveySketchAssignment.controller");
const surveySketchAssignmentFlowController = require("../controllers/config/surveySketchAssignmentFlow.controller");
const notificationController = require("../controllers/notification.controller");
const { parsePagination } = require("../utils/pagination");
const authService = require("../services/auth.service");
const { validate, schemas, validObjectId } = require("../middleware/validator");
const { authorize } = require("../middleware/auth.middleware");
const { USER_ROLES, SURVEY_SKETCH_STATUS } = require("../config/constants");
const { ok } = require("../utils/response");
const asyncHandler = require("../utils/asyncHandler");
const logger = require("../utils/logger");
const { BadRequestError } = require("../utils/errors");

function getPathParams(event) {
  return event.pathParameters || {};
}

function getQueryParams(event) {
  const q = event.queryStringParameters || {};
  return {
    page: q.page,
    limit: q.limit,
    role: q.role,
    status: q.status,
    surveyorId: q.surveyorId,
    cadCenterId: q.cadCenterId,
    surveyorSketchUploadId: q.surveyorSketchUploadId,
  };
}

let dbConnected = false;
let dbConnectionPromise = null;

async function ensureDb() {
  // If already connected, return immediately
  if (dbConnected && mongoose.connection.readyState === 1) {
    return;
  }

  // If connection is in progress, wait for it
  if (dbConnectionPromise) {
    await dbConnectionPromise;
    return;
  }

  // Start new connection
  dbConnectionPromise = (async () => {
    try {
      logger.info("Starting database connection", {
        currentState: mongoose.connection.readyState,
        dbConnected,
      });
      await connectDB();
      dbConnected = true;
      logger.info("Database connection successful", {
        readyState: mongoose.connection.readyState,
      });
    } catch (error) {
      dbConnectionPromise = null; // Reset on error so we can retry
      logger.error("Database connection failed", error);
      throw error;
    }
  })();

  await dbConnectionPromise;
}

// -------- Super Admin Registration --------
exports.registerSuperAdmin = asyncHandler(async (event) => {
  await ensureDb();
  const hasSuperAdmin = await authService.hasSuperAdmin();
  if (hasSuperAdmin) {
    await authorize(USER_ROLES.SUPER_ADMIN)(event);
  }
  const body = validate(schemas.superAdminRegister)(event);
  return await authController.registerSuperAdmin(body);
});

// -------- Surveyor Step 1: Send OTP (phone + name) --------
exports.surveyorSendOtp = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.surveyorStart)(event);
  return await authController.surveyorSendOtp(body);
});

// -------- Surveyor Step 2: Verify OTP --------
exports.surveyorVerifyOtp = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.surveyorVerifyOtp)(event);
  return await authController.surveyorVerifyOtp(body);
});

// -------- Surveyor Step 3: Complete Registration (password + profile) --------
exports.surveyorCompleteRegistration = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.surveyorCompleteRegistration)(event);
  return await authController.surveyorCompleteRegistration(body);
});

// -------- Surveyor Forgot Password Step 1: send OTP --------
exports.surveyorForgotPasswordStart = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.surveyorForgotPasswordStart)(event);
  return await authController.surveyorForgotPasswordStart(body);
});

// -------- Surveyor Forgot Password Step 2: verify OTP + reset password --------
exports.surveyorForgotPasswordReset = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.surveyorForgotPasswordReset)(event);
  return await authController.surveyorForgotPasswordReset(body);
});

// -------- Login --------
exports.login = asyncHandler(async (event) => {
  await ensureDb();
  const body = validate(schemas.login)(event);
  return await authController.login(body);
});

// -------- Create User (Admin / CAD / Surveyor) --------
exports.createUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const body = validate(schemas.createUser)(event);
  return await userController.createUser(user, body);
});

// -------- Get User by ID --------
exports.getUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { userId } = getPathParams(event);
  if (!userId) throw new BadRequestError("userId is required");
  validObjectId(userId, "userId");
  return await userController.getById(user, userId);
});

// -------- List Users (pagination: page, limit; filters: role, status) --------
exports.listUsers = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const options = getQueryParams(event);
  return await userController.getAll(user, options);
});

// -------- Get Users by Role (GET /api/users/role/{role}; query: page, limit, status) --------
exports.getUsersByRole = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { role } = event.pathParameters || {};
  if (!role) throw new BadRequestError("role is required");
  const options = getQueryParams(event);
  return await userController.getByRole(user, role, options);
});

// -------- Patch User --------
exports.updateUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { userId } = getPathParams(event);
  if (!userId) throw new BadRequestError("userId is required");
  validObjectId(userId, "userId");
  const body = validate(schemas.userPatch)(event);
  return await userController.updateUser(user, userId, body);
});

// -------- Delete User (soft delete) --------
exports.deleteUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { userId } = getPathParams(event);
  if (!userId) throw new BadRequestError("userId is required");
  validObjectId(userId, "userId");
  return await userController.deleteUser(user, userId);
});

// -------- Block User (Super Admin: any user; Admin: only CAD/Surveyor; cannot block self) --------
exports.blockUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { userId } = getPathParams(event);
  if (!userId) throw new BadRequestError("userId is required");
  validObjectId(userId, "userId");
  return await userController.blockUser(user, userId);
});

// -------- Unblock User (same permissions as block) --------
exports.unblockUser = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { userId } = getPathParams(event);
  if (!userId) throw new BadRequestError("userId is required");
  validObjectId(userId, "userId");
  return await userController.unblockUser(user, userId);
});

// -------- Surveyor Sketch Upload --------
exports.createSurveyorSketchUpload = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR)(event);
  const body = validate(schemas.surveyorSketchUploadCreate)(event);
  return await surveyorSketchUploadController.createUpload(user, body);
});

exports.getSurveyorSketchUpload = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const { uploadId } = getPathParams(event);
  if (!uploadId) throw new BadRequestError("uploadId is required");
  validObjectId(uploadId, "uploadId");
  return await surveyorSketchUploadController.getUpload(user, uploadId);
});

exports.listSurveyorSketchUploads = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const q = getQueryParams(event);
  const options = {
    page: q.page,
    limit: q.limit,
    status: q.status,
    surveyorId: q.surveyorId,
    cadCenterId: q.cadCenterId,
  };
  return await surveyorSketchUploadController.listUploads(user, options);
});

// -------- Surveyor Sketch Draft --------
exports.createSurveyDraft = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR)(event);
  const body = validate(schemas.surveyDraftCreate)(event);
  return await surveyDraftController.createDraft(user, body);
});

exports.listSurveyDrafts = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const q = getQueryParams(event);
  const options = {
    page: q.page,
    limit: q.limit,
    surveyorId: q.surveyorId,
  };
  return await surveyDraftController.listDrafts(user, options);
});

exports.getSurveyDraft = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const { draftId } = getPathParams(event);
  if (!draftId) throw new BadRequestError("draftId is required");
  validObjectId(draftId, "draftId");
  return await surveyDraftController.getDraft(user, draftId);
});

exports.updateSurveyDraft = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR)(event);
  const { draftId } = getPathParams(event);
  if (!draftId) throw new BadRequestError("draftId is required");
  validObjectId(draftId, "draftId");
  const body = validate(schemas.surveyDraftUpdate)(event);
  return await surveyDraftController.updateDraft(user, draftId, body);
});

exports.deleteSurveyDraft = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR)(event);
  const { draftId } = getPathParams(event);
  if (!draftId) throw new BadRequestError("draftId is required");
  validObjectId(draftId, "draftId");
  return await surveyDraftController.deleteDraft(user, draftId);
});

// -------- Notifications --------
exports.listNotifications = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const q = event.queryStringParameters || {};
  const options = schemas.notificationListQuery(q);
  return await notificationController.listNotifications(user, options);
});

exports.getNotification = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const { notificationId } = getPathParams(event);
  if (!notificationId) throw new BadRequestError("notificationId is required");
  validObjectId(notificationId, "notificationId");
  return await notificationController.getNotification(user, notificationId);
});

exports.markNotificationRead = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  const { notificationId } = getPathParams(event);
  if (!notificationId) throw new BadRequestError("notificationId is required");
  validObjectId(notificationId, "notificationId");
  return await notificationController.markNotificationRead(user, notificationId);
});

exports.markAllNotificationsRead = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN)(event);
  return await notificationController.markAllNotificationsRead(user);
});

// -------- Survey Sketch Status options (Admin: for status dropdown) --------
exports.getSurveySketchStatuses = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  return ok(Object.values(SURVEY_SKETCH_STATUS));
});

// -------- Survey Sketch Assignment (Admin: assign survey sketch to CAD center) --------
exports.createSurveySketchAssignment = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const body = validate(schemas.surveySketchAssignmentCreate)(event);
  return await surveySketchAssignmentController.createAssignment(user, body);
});

exports.getSurveySketchAssignment = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { assignmentId } = getPathParams(event);
  if (!assignmentId) throw new BadRequestError("assignmentId is required");
  validObjectId(assignmentId, "assignmentId");
  return await surveySketchAssignmentController.getAssignment(assignmentId);
});

exports.listSurveySketchesWithAssignments = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const q = event.queryStringParameters || {};
  const options = { page: q.page, limit: q.limit };
  return await surveyorSketchUploadController.listAllWithAssignment(options);
});

// List all survey sketch uploads (SurveyorSketchUpload only). Optional query: status (PENDING, ASSIGNED, etc.).
exports.listSurveySketchAssignments = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const q = event.queryStringParameters || {};
  const options = { page: q.page, limit: q.limit };
  if (q.status != null && q.status !== "") options.status = q.status;
  return await surveyorSketchUploadController.listUploads(user, options);
});

exports.listAssignmentsByCadCenter = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { cadCenterId } = getPathParams(event);
  if (!cadCenterId) throw new BadRequestError("cadCenterId is required");
  validObjectId(cadCenterId, "cadCenterId");
  const q = event.queryStringParameters || {};
  const options = { page: q.page, limit: q.limit, status: q.status };
  return await surveySketchAssignmentController.listByCadCenter(cadCenterId, options);
});

exports.updateSurveySketchAssignment = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const { assignmentId } = getPathParams(event);
  if (!assignmentId) throw new BadRequestError("assignmentId is required");
  validObjectId(assignmentId, "assignmentId");
  const body = validate(schemas.surveySketchAssignmentUpdate)(event);
  return await surveySketchAssignmentController.updateAssignment(assignmentId, body, user);
});

// -------- CAD: Accept or reject assignment (ASSIGNED → IN_PROGRESS or CANCELLED) --------
exports.acceptAssignmentByCad = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.CAD)(event);
  const { assignmentId } = getPathParams(event);
  if (!assignmentId) throw new BadRequestError("assignmentId is required");
  validObjectId(assignmentId, "assignmentId");
  const payload = validate(schemas.cadAssignmentRespond)(event);
  return await surveySketchAssignmentController.respondToAssignment(assignmentId, user, payload);
});

// -------- CAD: List my assignments (direct assignee or legacy center pool) --------
exports.listCadAssignments = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.CAD)(event);
  const q = event.queryStringParameters || {};
  const options = { page: q.page, limit: q.limit, status: q.status };
  return await surveySketchAssignmentController.listForCadUser(user, options);
});

// -------- CAD: Get source sketch upload (inputs) for work --------
exports.getCadSketchUpload = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.CAD)(event);
  const { uploadId } = getPathParams(event);
  if (!uploadId) throw new BadRequestError("uploadId is required");
  validObjectId(uploadId, "uploadId");
  return await surveyorSketchUploadController.getUploadForCad(user, uploadId);
});

// -------- CAD: Submit finished sketch (sets cadDeliverable on upload; assignment COMPLETED) --------
exports.deliverCadSketch = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.CAD)(event);
  const { assignmentId } = getPathParams(event);
  if (!assignmentId) throw new BadRequestError("assignmentId is required");
  validObjectId(assignmentId, "assignmentId");
  const body = validate(schemas.cadSketchDeliverable)(event);
  return await surveySketchAssignmentController.deliverCadSketch(assignmentId, user, body);
});

// -------- Admin: Auto assignment flow toggle --------
exports.getSurveySketchAssignmentFlow = asyncHandler(async (event) => {
  await ensureDb();
  await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  return await surveySketchAssignmentFlowController.getFlowSettings();
});

exports.updateSurveySketchAssignmentFlow = asyncHandler(async (event) => {
  await ensureDb();
  const { user } = await authorize(USER_ROLES.SUPER_ADMIN, USER_ROLES.ADMIN)(event);
  const body = validate(schemas.surveySketchAssignmentFlowUpdate)(event);
  return await surveySketchAssignmentFlowController.updateFlowSettings(user, body);
});
