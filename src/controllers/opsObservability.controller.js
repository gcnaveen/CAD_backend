/**
 * Admin ops observability + public health (M-07).
 */

const { mongoose } = require("../config/db");
const opsObservability = require("../services/opsObservability.service");
const { ok, json } = require("../utils/response");
const { getCorrelationId } = require("../utils/requestContext");

async function getHealth() {
  const correlationId = getCorrelationId();
  let db = "unknown";
  let okFlag = true;
  try {
    const state = mongoose.connection?.readyState;
    if (state === 1 && mongoose.connection.db) {
      // Non-mutating connectivity check (no collection writes).
      await mongoose.connection.db.admin().command({ ping: 1 });
      db = "up";
    } else if (state === 2) {
      db = "connecting";
      okFlag = false;
    } else {
      db = "down";
      okFlag = false;
    }
  } catch {
    db = "down";
    okFlag = false;
  }

  const payload = {
    ok: okFlag,
    service: "cad-backend-api",
    stage: process.env.STAGE || null,
    time: new Date().toISOString(),
    db,
    correlationId,
    slaHours: Math.round(opsObservability.getDeliverySlaMs() / 3600000),
  };

  if (!okFlag) {
    return json(503, { success: false, data: payload });
  }
  return ok(payload);
}

async function getObservability() {
  const data = await opsObservability.getObservabilitySnapshot();
  return ok(data);
}

module.exports = {
  getHealth,
  getObservability,
};
