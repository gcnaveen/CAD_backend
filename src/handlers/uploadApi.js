/**
 * Upload API – images and audio only
 * POST /api/upload/image  – presigned URL for image
 * POST /api/upload/audio  – presigned URL for audio
 * POST /api/upload/delete – delete by key or fileUrl
 * Bucket: caddrawing. Image/audio upload are public; delete requires auth.
 */

const { validate, schemas } = require("../middleware/validator");
const { authorize } = require("../middleware/auth.middleware");
const { USER_ROLES } = require("../config/constants");
const uploadController = require("../controllers/upload.controller");
const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");

const { connectDB } = require("../config/db");
let dbConnected = false;

async function ensureDb() {
  if (!dbConnected) {
    await connectDB();
    dbConnected = true;
  }
}

const uploadAuth = () =>
  authorize(USER_ROLES.SURVEYOR, USER_ROLES.CAD, USER_ROLES.ADMIN, USER_ROLES.SUPER_ADMIN);

exports.handler = asyncHandler(async (event) => {
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  const routeKey =
    event.routeKey ||
    `${(event.requestContext?.http?.method || "").toUpperCase()} ${path}`.trim();

  switch (routeKey) {
    case "POST /api/upload/image": {
      const params = validate(schemas.uploadImage)(event);
      return await uploadController.getImageUploadUrl(params, null);
    }

    case "POST /api/upload/audio": {
      const params = validate(schemas.uploadAudio)(event);
      return await uploadController.getAudioUploadUrl(params, null);
    }

    case "POST /api/upload/delete": {
      await ensureDb();
      const { user } = await uploadAuth()(event);
      const params = validate(schemas.uploadDelete)(event);
      return await uploadController.deleteUpload(params, user);
    }

    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
