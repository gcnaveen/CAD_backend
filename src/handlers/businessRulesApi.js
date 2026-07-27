/**
 * GET /api/public/business-rules — approved baseline for marketing / FE (H-08).
 * No auth. No secrets.
 */
const { json } = require("../utils/response");
const { getApprovedBusinessRulesPublic } = require("../config/businessRulesBaseline");

module.exports.handler = async () => {
  return json(200, {
    ok: true,
    data: getApprovedBusinessRulesPublic(),
  });
};
