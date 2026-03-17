const SurveySketchAssignmentFlow = require("../../models/config/SurveySketchAssignmentFlow");

async function getSettings() {
  const key = SurveySketchAssignmentFlow.flowKey;
  const doc = await SurveySketchAssignmentFlow.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, autoAssignEnabled: false } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .populate("updatedBy", "name role")
    .lean();
  return doc;
}

async function updateSettings(payload, actor) {
  const key = SurveySketchAssignmentFlow.flowKey;
  const doc = await SurveySketchAssignmentFlow.findOneAndUpdate(
    { key },
    {
      $set: {
        autoAssignEnabled: Boolean(payload.autoAssignEnabled),
        updatedBy: actor?._id || null,
      },
      $setOnInsert: { key },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .populate("updatedBy", "name role")
    .lean();
  return doc;
}

async function getAutoAssignState() {
  const doc = await getSettings();
  return {
    enabled: Boolean(doc?.autoAssignEnabled),
    updatedBy: doc?.updatedBy?._id || doc?.updatedBy || null,
  };
}

module.exports = {
  getSettings,
  updateSettings,
  getAutoAssignState,
};
