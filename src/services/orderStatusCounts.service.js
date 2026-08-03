/**
 * Canonical sketch-order status counts (COUNT-01).
 * Dashboard, ops funnel, and request-list counts MUST use this helper.
 */

const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const { SURVEY_SKETCH_STATUS } = require("../config/constants");

function canonicalStatusCodes() {
  return [...new Set(Object.values(SURVEY_SKETCH_STATUS))];
}

function emptyByStatus() {
  return Object.fromEntries(canonicalStatusCodes().map((s) => [s, 0]));
}

function normalizeStatusKey(raw) {
  if (raw == null || raw === "") return null;
  if (raw === "UNDER_REVIEW") return SURVEY_SKETCH_STATUS.UNDER_REVISION;
  return String(raw);
}

/**
 * Aggregate SurveyorSketchUpload by status.
 * Null/missing status rows are excluded from total (same as dashboard).
 *
 * @param {{ match?: object }} [options]
 * @returns {Promise<{ total: number, byStatus: Record<string, number> }>}
 */
async function getOrderStatusCounts({ match = {} } = {}) {
  const pipeline = [];
  if (match && Object.keys(match).length) {
    pipeline.push({ $match: match });
  }
  pipeline.push({ $group: { _id: "$status", count: { $sum: 1 } } });

  const rows = await SurveyorSketchUpload.aggregate(pipeline);
  const byStatus = emptyByStatus();
  let total = 0;

  for (const r of rows) {
    const key = normalizeStatusKey(r._id);
    if (!key) continue;
    if (byStatus[key] !== undefined) byStatus[key] += r.count;
    else byStatus[key] = r.count;
    total += r.count;
  }

  return { total, byStatus };
}

/**
 * Admin dashboard `orders` shape (byStatus includes nested `total`).
 */
function toDashboardOrdersShape({ total, byStatus }) {
  return {
    byStatus: { ...byStatus, total },
    totalOrders: total,
  };
}

module.exports = {
  canonicalStatusCodes,
  emptyByStatus,
  normalizeStatusKey,
  getOrderStatusCounts,
  toDashboardOrdersShape,
};
