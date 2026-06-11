const cadWalletService = require("../../services/cadWallet.service");
const { ok } = require("../../utils/response");
const { paginationMeta } = require("../../utils/pagination");

async function getWalletSummary(cadUser) {
  const data = await cadWalletService.getSummaryForCad(cadUser._id);
  return ok(data);
}

async function listWalletTransactions(cadUser, query = {}) {
  const result = await cadWalletService.listTransactionsForCad(cadUser._id, {
    page: query.page,
    limit: query.limit,
  });
  return ok(result.data, {
    pagination: paginationMeta(
      { page: result.page, limit: result.limit },
      result.total
    ),
  });
}

async function markWalletEntryPaid(actor, entryId) {
  const data = await cadWalletService.markEntryPaid(entryId, actor);
  return ok(data);
}

async function recordWalletPayment(actor, entryId, payload) {
  const data = await cadWalletService.recordPayment(entryId, actor, payload);
  return ok(data);
}

async function recordWalletPaymentForCadUser(actor, payload) {
  const data = await cadWalletService.recordPaymentForCadUser(payload.cadUserId, actor, payload);
  return ok(data);
}

module.exports = {
  getWalletSummary,
  listWalletTransactions,
  markWalletEntryPaid,
  recordWalletPayment,
  recordWalletPaymentForCadUser,
};
