const SurveySketchAssignmentFlow = require("../../models/config/SurveySketchAssignmentFlow");
const { BadRequestError } = require("../../utils/errors");

async function getSettings() {
  const key = SurveySketchAssignmentFlow.flowKey;
  const doc = await SurveySketchAssignmentFlow.findOneAndUpdate(
    { key },
    { $setOnInsert: { key, autoAssignEnabled: false } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
    .select("key autoAssignEnabled updatedBy createdAt updatedAt")
    .populate("updatedBy", "name role")
    .lean();
  return doc;
}

async function updateSettings(payload, actor) {
  if (payload.autoAssignEnabled === undefined) {
    throw new BadRequestError("autoAssignEnabled is required", {
      code: "AUTO_ASSIGN_REQUIRED",
      errors: [{ field: "autoAssignEnabled", message: "Required" }],
    });
  }
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
    .select("key autoAssignEnabled updatedBy createdAt updatedAt")
    .populate("updatedBy", "name role")
    .lean();
  return doc;
}

async function getAutoAssignState() {
  const doc = await SurveySketchAssignmentFlow.findOne({ key: SurveySketchAssignmentFlow.flowKey })
    .select("autoAssignEnabled updatedBy")
    .lean();
  if (!doc) {
    return { enabled: false, updatedBy: null };
  }
  return {
    enabled: Boolean(doc.autoAssignEnabled),
    updatedBy: doc.updatedBy || null,
  };
}

module.exports = {
  getSettings,
  updateSettings,
  getAutoAssignState,
};
