/**
 * GET /api/version — safe build provenance (audit H-05).
 * No secrets, no Mongo connection required.
 */
const { json } = require("../utils/response");
const { getBuildIdentity } = require("../config/buildIdentity");

module.exports.handler = async () => {
  const identity = getBuildIdentity();
  return json(200, {
    ok: true,
    ...identity,
  });
};
