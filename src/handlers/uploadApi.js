/**
 * Upload API – images, audio, CAD deliverables (H-10 auth + H-12 DWG/DXF)
 * POST /api/upload/image|audio – authenticated presign
 * POST /api/upload/cad-deliverable – CAD source/preview presign
 * POST /api/upload/cad-deliverable/multipart/* – large CAD multipart
 * POST /api/upload/confirm – magic-byte / DWG / DXF / AV gate after PUT
 * POST /api/upload/delete – delete by key or fileUrl
 */

const { validate, schemas } = require("../middleware/validator");
const { authorize } = require("../middleware/auth.middleware");
const { USER_ROLES } = require("../config/constants");
const uploadController = require("../controllers/upload.controller");
const { BadRequestError } = require("../utils/errors");
const asyncHandler = require("../utils/asyncHandler");
const { extractRequestMeta } = require("../services/authAudit.service");

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

  await ensureDb();
  const { user } = await uploadAuth()(event);
  const meta = extractRequestMeta ? extractRequestMeta(event) : {};

  switch (routeKey) {
    case "POST /api/upload/image": {
      const params = validate(schemas.uploadImage)(event);
      return await uploadController.getImageUploadUrl(params, user, meta);
    }

    case "POST /api/upload/audio": {
      const params = validate(schemas.uploadAudio)(event);
      return await uploadController.getAudioUploadUrl(params, user, meta);
    }

    case "POST /api/upload/cad-deliverable": {
      const params = validate(schemas.uploadCadDeliverable)(event);
      return await uploadController.getCadDeliverableUploadUrl(params, user, meta);
    }

    case "POST /api/upload/cad-deliverable/multipart/start": {
      const params = validate(schemas.uploadCadDeliverable)(event);
      return await uploadController.startCadDeliverableMultipart(params, user, meta);
    }

    case "POST /api/upload/cad-deliverable/multipart/part": {
      const params = validate(schemas.uploadCadDeliverablePart)(event);
      return await uploadController.getCadDeliverablePartUrl(params, user, meta);
    }

    case "POST /api/upload/cad-deliverable/multipart/complete": {
      const params = validate(schemas.uploadCadDeliverableComplete)(event);
      return await uploadController.completeCadDeliverableMultipart(params, user, meta);
    }

    case "POST /api/upload/cad-deliverable/multipart/abort": {
      const params = validate(schemas.uploadCadDeliverableAbort)(event);
      return await uploadController.abortCadDeliverableMultipart(params, user, meta);
    }

    case "POST /api/upload/confirm": {
      const params = validate(schemas.uploadConfirm)(event);
      return await uploadController.confirmUpload(params, user, meta);
    }

    case "POST /api/upload/delete": {
      const params = validate(schemas.uploadDelete)(event);
      return await uploadController.deleteUpload(params, user, meta);
    }

    default:
      throw new BadRequestError(`Unsupported route: ${routeKey}`);
  }
});
