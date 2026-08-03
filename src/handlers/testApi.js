/**
 * Legacy GET /test handler — removed from API Gateway (audit).
 * Mutating health_checks upserts are forbidden. Use GET /api/health (read-only ping).
 *
 * Kept only so accidental local invokes fail closed with a clear message.
 */
const { json } = require("../utils/response");

module.exports.handler = async () => {
  return json(410, {
    success: false,
    message:
      "GET /test has been removed. Use GET /api/health (non-mutating DB ping) or GET /api/version.",
    code: "TEST_ENDPOINT_REMOVED",
    healthPath: "/api/health",
    versionPath: "/api/version",
  });
};
