const adminDashboardService = require("../services/adminDashboard.service");
const { ok } = require("../utils/response");

async function getStats() {
  const data = await adminDashboardService.getDashboardStats();
  return ok(data);
}

module.exports = {
  getStats,
};
