const surveyDraftService = require("../services/surveyDraft.service");
const { ok, created } = require("../utils/response");

async function createDraft(actor, payload) {
  const result = await surveyDraftService.create(actor, payload);
  return created(result);
}

async function getDraft(actor, draftId) {
  const result = await surveyDraftService.getById(actor, draftId);
  return ok(result);
}

async function listDrafts(actor, options) {
  const result = await surveyDraftService.list(actor, options);
  return ok(result.data, result.meta);
}

async function updateDraft(actor, draftId, updates) {
  const result = await surveyDraftService.update(actor, draftId, updates);
  return ok(result);
}

async function deleteDraft(actor, draftId) {
  const result = await surveyDraftService.remove(actor, draftId);
  return ok(result);
}

module.exports = {
  createDraft,
  getDraft,
  listDrafts,
  updateDraft,
  deleteDraft,
};
