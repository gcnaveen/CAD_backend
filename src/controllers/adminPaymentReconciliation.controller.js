/**
 * Admin payment reconciliation controller (audit §4.1 point 29).
 */

const paymentReconciliation = require("../services/paymentReconciliation.service");
const { ok } = require("../utils/response");

async function getDailyReconciliation(query = {}) {
  const summary = await paymentReconciliation.runDailyReconciliation({
    asOf: query.asOf || query.date || undefined,
    from: query.from || undefined,
    to: query.to || undefined,
    persist: query.persist === "false" || query.persist === false ? false : true,
  });
  return ok(summary);
}

module.exports = {
  getDailyReconciliation,
};
