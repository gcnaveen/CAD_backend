const { BadRequestError } = require("./errors");

const DEFAULT_MAX_FILES = 20;

/**
 * Parse one survey file reference (URL string or metadata object).
 * @param {unknown} raw
 * @returns {{ url: string, fileName: string|null, mimeType: string|null, size: number|null, uploadedAt: Date }|null}
 */
function parseSurveyDocumentEntry(raw) {
  if (raw == null || raw === "") return null;
  const url =
    typeof raw === "string"
      ? raw.trim()
      : (raw.url || raw.path || "").toString().trim();
  if (!url) return null;
  if (typeof raw === "string") {
    return { url, fileName: null, mimeType: null, size: null, uploadedAt: new Date() };
  }
  return {
    url,
    fileName: raw.fileName != null ? String(raw.fileName).trim() : null,
    mimeType: raw.mimeType != null ? String(raw.mimeType).trim() : null,
    size: raw.size != null ? Number(raw.size) : null,
    uploadedAt: raw.uploadedAt ? new Date(raw.uploadedAt) : new Date(),
  };
}

/**
 * Accept a single file ref or an array of file refs.
 * @param {unknown} raw
 * @param {{ maxItems?: number, fieldName?: string, required?: boolean }} [options]
 * @returns {Array<{ url: string, fileName: string|null, mimeType: string|null, size: number|null, uploadedAt: Date }>}
 */
function parseSurveyDocumentList(raw, options = {}) {
  const maxItems = options.maxItems ?? DEFAULT_MAX_FILES;
  const fieldName = options.fieldName || "files";
  const required = options.required === true;

  if (raw == null || raw === "") {
    if (required) {
      throw new BadRequestError(`${fieldName} is required`, {
        errors: [{ field: fieldName, message: "Required" }],
      });
    }
    return [];
  }

  const items = Array.isArray(raw) ? raw : [raw];
  if (required && items.length === 0) {
    throw new BadRequestError(`${fieldName} must contain at least one file`, {
      errors: [{ field: fieldName, message: "At least one file is required" }],
    });
  }
  if (items.length > maxItems) {
    throw new BadRequestError(`${fieldName} must have at most ${maxItems} items`, {
      errors: [{ field: fieldName, message: `Max ${maxItems} items` }],
    });
  }

  const parsed = [];
  for (const item of items) {
    const entry = parseSurveyDocumentEntry(item);
    if (entry) parsed.push(entry);
  }

  if (required && parsed.length === 0) {
    throw new BadRequestError(`${fieldName} must contain at least one valid file URL`, {
      errors: [{ field: fieldName, message: "Invalid value" }],
    });
  }

  return parsed;
}

/**
 * Normalize legacy single-object storage to an array for API responses.
 * @param {unknown} value
 * @returns {Array<Record<string, unknown>>}
 */
function normalizeStoredDocumentList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object" && value.url) return [value];
  return [];
}

/**
 * Primary file from a stored list (first item).
 * @param {unknown} value
 * @returns {Record<string, unknown>|null}
 */
function primaryStoredDocument(value) {
  const list = normalizeStoredDocumentList(value);
  return list[0] || null;
}

/**
 * Normalize document map values in place (Mongoose Map) or to a plain object (lean/JSON).
 * Never replace a Mongoose Map with `{}` — that breaks Map casting on save.
 */
function normalizeDocumentsField(documents, { asPlainObject = false } = {}) {
  if (documents == null) {
    return asPlainObject ? {} : documents;
  }

  if (documents instanceof Map) {
    for (const [key, value] of documents.entries()) {
      documents.set(key, normalizeStoredDocumentList(value));
    }
    if (!asPlainObject) return documents;
    return Object.fromEntries([...documents.entries()]);
  }

  if (typeof documents !== "object") return asPlainObject ? {} : documents;

  const normalized = {};
  for (const [key, value] of Object.entries(documents)) {
    normalized[key] = normalizeStoredDocumentList(value);
  }
  return normalized;
}

/** Build a Mongoose-ready Map from validator payload `{ key: files[] }`. */
function documentsMapFromObject(documentsObj = {}) {
  const map = new Map();
  for (const [key, value] of Object.entries(documentsObj || {})) {
    const entries = normalizeStoredDocumentList(value);
    if (entries.length) map.set(key, entries);
  }
  return map;
}

module.exports = {
  DEFAULT_MAX_FILES,
  parseSurveyDocumentEntry,
  parseSurveyDocumentList,
  normalizeStoredDocumentList,
  primaryStoredDocument,
  normalizeDocumentsField,
  documentsMapFromObject,
};
