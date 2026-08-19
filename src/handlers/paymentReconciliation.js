/**
 * Scheduled / invokeable daily payment reconciliation (audit §4.1 point 29 / M-07).
 * EventBridge: cron(0 1 * * ? *) → 01:00 UTC daily.
 * Emits structured ALERT logs for CloudWatch metric filters / ticket drills.
 */

const { connectDB } = require("../config/db");
const paymentReconciliation = require("../services/paymentReconciliation.service");
const opsObservability = require("../services/opsObservability.service");
const logger = require("../utils/logger");

exports.handler = async (event) => {
  const { assertProductionJwtSecret } = require("../config/secrets");
  assertProductionJwtSecret();
  await connectDB();
  const asOf = event?.asOf || event?.date || undefined;
  logger.info("Running payment reconciliation", { asOf: asOf || "today_utc" });
  const summary = await paymentReconciliation.runDailyReconciliation({
    asOf,
    persist: true,
  });

  const openFlags = Object.values(summary.flags || {}).reduce((s, n) => s + Number(n || 0), 0);
  logger.info("Payment reconciliation complete", {
    totalAttempts: summary.totalAttempts,
    flags: summary.flags,
    itemCount: summary.items.length,
    openFlagCount: openFlags,
  });

  if (openFlags > 0) {
    logger.warn("ALERT_PAYMENT_RECON_FLAGS", {
      alertType: "PAYMENT_MISMATCH",
      severity: "high",
      openFlagCount: openFlags,
      flags: summary.flags,
      sample: (summary.items || []).slice(0, 5),
      escalateTo: "operations",
    });
  }

  let sla = null;
  try {
    sla = await opsObservability.getSlaAging();
    if (sla.breached > 0) {
      logger.warn("ALERT_SLA_BREACH", {
        alertType: "SLA_AGING",
        severity: "high",
        breached: sla.breached,
        withinSla: sla.withinSla,
        slaHours: sla.slaHours,
        sample: (sla.items || []).slice(0, 5),
        escalateTo: "operations",
      });
    }
  } catch (err) {
    logger.error("SLA aging check failed during recon job", err);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      data: { reconciliation: summary, sla },
    }),
  };
};
