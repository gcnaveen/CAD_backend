const autoAssign = require("../services/autoAssign.service");
const flowService = require("../services/config/surveySketchAssignmentFlow.service");
const { ok } = require("../utils/response");
const { validObjectId } = require("../middleware/validator");
const { BadRequestError, NotFoundError } = require("../utils/errors");
const { recordAdminAction } = require("../services/adminAudit.service");
const authAudit = require("../services/authAudit.service");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");

async function getFlowSettings() {
  const settings = await flowService.getSettings();
  const policy = autoAssign.getPolicy();
  const queue = await autoAssign.listExceptionQueue({ page: 1, limit: 1 });
  return ok({
    ...settings,
    policy,
    exceptionQueueTotal: queue.total,
    /** FE: do not hard-disable manual assign — use per-order gate + this policy. */
    manualAssignHint:
      "When autoAssignEnabled is true, enable manual assign only if order.manualOverrideAllowed or gate.allowed.",
  });
}

async function updateFlowSettings(actor, payload) {
  const result = await flowService.updateSettings(payload, actor);
  return ok({ ...result, policy: autoAssign.getPolicy() });
}

async function listExceptions(query = {}) {
  const data = await autoAssign.listExceptionQueue({
    page: query.page,
    limit: query.limit,
  });
  return ok(data);
}

async function retryAutoAssign(actor, uploadId) {
  if (!uploadId) throw new BadRequestError("uploadId is required");
  validObjectId(uploadId, "uploadId");
  const result = await autoAssign.tryAutoAssign(uploadId, {
    source: "MANUAL_RETRY",
    actorUserId: actor._id,
  });
  const meta = authAudit.extractRequestMeta({});
  await recordAdminAction({
    action: "AUTO_ASSIGN_MANUAL_RETRY",
    actor,
    targetType: "SurveyorSketchUpload",
    targetId: uploadId,
    success: Boolean(result?.ok || result?.state),
    meta: { code: result?.code || result?.state || null },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return ok(result);
}

async function getAttempts(uploadId) {
  if (!uploadId) throw new BadRequestError("uploadId is required");
  validObjectId(uploadId, "uploadId");
  const attempts = await autoAssign.listAttemptsForUpload(uploadId);
  return ok({ attempts });
}

async function getManualGate(uploadId) {
  if (!uploadId) throw new BadRequestError("uploadId is required");
  validObjectId(uploadId, "uploadId");
  const upload = await SurveyorSketchUpload.findById(uploadId).select("status autoAssignMeta");
  if (!upload) {
    throw new NotFoundError("Upload not found", { code: "SURVEY_SKETCH_NOT_FOUND" });
  }
  const gate = await autoAssign.getManualAssignGate(upload);
  return ok(gate);
}

module.exports = {
  getFlowSettings,
  updateFlowSettings,
  listExceptions,
  retryAutoAssign,
  getAttempts,
  getManualGate,
};
