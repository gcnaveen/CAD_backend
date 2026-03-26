const cadInterestService = require("../services/cadInterest.service");
const { ok, created } = require("../utils/response");

async function createCadInterest(payload) {
  const result = await cadInterestService.create(payload);
  if (result.alreadySubmitted) return ok(result.doc);
  return created(result.doc);
}

async function listCadInterests(actor, options) {
  const result = await cadInterestService.list(options);
  return ok(result.data, result.meta);
}

module.exports = {
  createCadInterest,
  listCadInterests,
};

