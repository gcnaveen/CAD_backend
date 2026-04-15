const service = require("../../services/config/sketchPricingAdmin.service");
const { ok } = require("../../utils/response");

async function getSketchPricing() {
  const result = await service.getPricingSettings();
  return ok(result);
}

async function updateSketchPricing(actor, payload) {
  const result = await service.updatePricingSettings(payload, actor);
  return ok(result);
}

module.exports = {
  getSketchPricing,
  updateSketchPricing,
};
