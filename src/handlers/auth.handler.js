const { connectDB, mongoose } = require("../config/db");
const authController = require("../controllers/auth.controller");
const userController = require("../controllers/user.controller");
const surveyorSketchUploadController = require("../controllers/surveyorSketchUpload.controller");
const authService = require("../services/auth.service");
const { validate, schemas, validObjectId } = require("../middleware/validator");
const { authorize } = require("../middleware/auth.middleware");
const { USER_ROLES } = require("../config/constants");
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
  };
  return await surveyorSketchUploadController.listUploads(user, options);
});
