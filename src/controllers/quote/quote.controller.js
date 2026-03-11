const quoteService = require("../../services/quote/quote.service");
const { ok, created } = require("../../utils/response");
const { paginationMeta } = require("../../utils/pagination");

async function createQuote(actor, payload) {
  const result = await quoteService.create(actor, payload);
  return created(result);
}

async function getQuote(actor, quoteId) {
  const result = await quoteService.getById(actor, quoteId);
  return ok(result);
}

async function listQuotes(actor, query) {
  const result = await quoteService.list(actor, query);
  return ok(result.data, { pagination: paginationMeta(result.meta, result.meta.total) });
}

async function patchQuote(actor, quoteId, updates) {
  const result = await quoteService.patch(actor, quoteId, updates);
  return ok(result);
}

module.exports = {
  createQuote,
  getQuote,
  listQuotes,
  patchQuote,
};
