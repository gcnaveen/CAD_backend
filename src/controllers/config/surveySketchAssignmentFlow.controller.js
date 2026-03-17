const service = require("../../services/config/surveySketchAssignmentFlow.service");
const { ok } = require("../../utils/response");

async function getFlowSettings() {
  const result = await service.getSettings();
  return ok(result);
}

async function updateFlowSettings(actor, payload) {
  const result = await service.updateSettings(payload, actor);
  return ok(result);
}

module.exports = {
  getFlowSettings,
  updateFlowSettings,
};
