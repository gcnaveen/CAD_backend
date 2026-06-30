const cadWalletService = require("../../services/cadWallet.service");
const surveySketchAssignmentService = require("../../services/assignment/surveySketchAssignment.service");
const { ok } = require("../../utils/response");

/** CAD home dashboard: wallet totals + order counts in one response. */
async function getOverview(cadUser) {
  await cadWalletService.syncCadWalletFromCompletedAssignments(cadUser._id);
  const [wallet, orders] = await Promise.all([
    cadWalletService.getSummaryForCad(cadUser._id),
    surveySketchAssignmentService.getCadDashboardStats(cadUser),
  ]);
  return ok({ wallet, orders });
}

module.exports = {
  getOverview,
};
