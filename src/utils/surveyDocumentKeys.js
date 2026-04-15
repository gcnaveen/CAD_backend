const { SURVEY_SKETCH_DOCUMENT_KEY_ALIASES } = require("../config/constants");

/**
 * Read a survey sketch document field from the request body using the canonical key
 * or a known alias (e.g. rr_pakkabook → rrPakkabook, kharabuttar → kharabu).
 */
function pickSurveyDocumentRaw(body, canonicalKey) {
  if (!body || typeof body !== "object") return undefined;
  const direct = body[canonicalKey];
  if (direct != null && direct !== "") return direct;
  for (const [alias, target] of Object.entries(SURVEY_SKETCH_DOCUMENT_KEY_ALIASES)) {
    if (target !== canonicalKey) continue;
    const v = body[alias];
    if (v != null && v !== "") return v;
  }
  return undefined;
}

module.exports = { pickSurveyDocumentRaw };
