const service = require("../../services/cadUserFeedback.service");
const { ok } = require("../../utils/response");

async function createCadUserFeedback(surveyor, assignmentId, payload) {
  const data = await service.createFeedback({
    assignmentId,
    surveyorId: surveyor._id,
    payload,
  });
  return ok(data);
}

async function getCadUserFeedback(actor, assignmentId) {
  const data = await service.getFeedbackByAssignment({ assignmentId, actor });
  return ok(data);
}

module.exports = {
  createCadUserFeedback,
  getCadUserFeedback,
};
