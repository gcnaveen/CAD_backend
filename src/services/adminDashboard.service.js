/**
 * Super Admin / Admin dashboard statistics.
 */

const User = require("../models/user/User");
const SurveyDraft = require("../models/surveyor/SurveyDraft");
const SurveyorSketchUpload = require("../models/surveyor/SurveyorSketchUpload");
const { USER_ROLES, SURVEY_SKETCH_STATUS } = require("../config/constants");

function paiseToRupees(paise) {
  const n = Number(paise);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n) / 100;
}

function emptyOrderStatusCounts() {
  const counts = { total: 0 };
  for (const status of Object.values(SURVEY_SKETCH_STATUS)) {
    counts[status] = 0;
  }
  return counts;
}

/**
 * @returns {Promise<{
 *   users: object,
 *   drafts: object,
 *   orders: object,
 *   payments: object,
 * }>}
 */
async function getDashboardStats() {
  const [
    userRoleRows,
    totalDrafts,
    orderStatusRows,
    sketchPaymentReceived,
    revisionPaymentReceived,
    sketchPendingRows,
    sketchFailedCount,
    revisionPendingRows,
    revisionFailedCount,
  ] = await Promise.all([
    User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
    SurveyDraft.countDocuments({ deletedAt: null }),
    SurveyorSketchUpload.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    SurveyorSketchUpload.aggregate([
      { $match: { "sketchPayment.status": "COMPLETED" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountPaise: {
            $sum: {
              $ifNull: ["$sketchPayment.paidAmountPaise", { $ifNull: ["$sketchPayment.amountPaise", 0] }],
            },
          },
        },
      },
    ]),
    SurveyorSketchUpload.aggregate([
      { $match: { revisionFeePayments: { $exists: true, $ne: [] } } },
      { $unwind: "$revisionFeePayments" },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountPaise: {
            $sum: {
              $ifNull: [
                "$revisionFeePayments.paidAmountPaise",
                { $ifNull: ["$revisionFeePayments.chargedAmountPaise", 0] },
              ],
            },
          },
        },
      },
    ]),
    SurveyorSketchUpload.aggregate([
      {
        $match: {
          status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
          "sketchPayment.status": { $ne: "COMPLETED" },
        },
      },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountPaise: { $sum: { $ifNull: ["$sketchPayment.amountPaise", 0] } },
        },
      },
    ]),
    SurveyorSketchUpload.countDocuments({ "sketchPayment.status": "FAILED" }),
    SurveyorSketchUpload.aggregate([
      { $match: { "pendingRevisionPayment.status": "PENDING" } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          amountPaise: { $sum: { $ifNull: ["$pendingRevisionPayment.amountPaise", 0] } },
        },
      },
    ]),
    SurveyorSketchUpload.countDocuments({ "pendingRevisionPayment.status": "FAILED" }),
  ]);

  const usersByRole = {};
  for (const row of userRoleRows) {
    usersByRole[row._id] = row.count;
  }

  const superAdminUsers = usersByRole[USER_ROLES.SUPER_ADMIN] || 0;
  const adminUsers = usersByRole[USER_ROLES.ADMIN] || 0;
  const cadUsers = usersByRole[USER_ROLES.CAD] || 0;
  const surveyorUsers = usersByRole[USER_ROLES.SURVEYOR] || 0;
  const totalUsers = userRoleRows.reduce((sum, r) => sum + r.count, 0);

  const ordersByStatus = emptyOrderStatusCounts();
  for (const row of orderStatusRows) {
    if (row._id) {
      ordersByStatus[row._id] = row.count;
      ordersByStatus.total += row.count;
    }
  }

  const sketchReceivedPaise = sketchPaymentReceived[0]?.amountPaise || 0;
  const sketchReceivedCount = sketchPaymentReceived[0]?.count || 0;
  const revisionReceivedPaise = revisionPaymentReceived[0]?.amountPaise || 0;
  const revisionReceivedCount = revisionPaymentReceived[0]?.count || 0;
  const totalReceivedPaise = sketchReceivedPaise + revisionReceivedPaise;

  const sketchPendingCount = sketchPendingRows[0]?.count || 0;
  const sketchPendingPaise = sketchPendingRows[0]?.amountPaise || 0;
  const revisionPendingCount = revisionPendingRows[0]?.count || 0;
  const revisionPendingPaise = revisionPendingRows[0]?.amountPaise || 0;

  const pendingCount = sketchPendingCount + revisionPendingCount;
  const pendingPaise = sketchPendingPaise + revisionPendingPaise;
  const failedCount = sketchFailedCount + revisionFailedCount;

  return {
    users: {
      totalUsers,
      superAdminUsers,
      adminUsers,
      cadUsers,
      surveyorUsers,
    },
    drafts: {
      totalDrafts,
    },
    orders: {
      byStatus: ordersByStatus,
      totalOrders: ordersByStatus.total,
    },
    payments: {
      totalReceived: {
        amountPaise: totalReceivedPaise,
        amountRupees: paiseToRupees(totalReceivedPaise),
        sketchUploadPayments: sketchReceivedCount,
        revisionPayments: revisionReceivedCount,
      },
      pending: {
        count: pendingCount,
        amountPaise: pendingPaise,
        amountRupees: paiseToRupees(pendingPaise),
        sketchUploadPending: sketchPendingCount,
        revisionPaymentPending: revisionPendingCount,
      },
      failed: {
        count: failedCount,
        sketchUploadFailed: sketchFailedCount,
        revisionPaymentFailed: revisionFailedCount,
      },
    },
  };
}

module.exports = {
  getDashboardStats,
};
