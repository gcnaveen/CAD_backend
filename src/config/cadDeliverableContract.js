/**
 * H-12: approved CAD deliverable contract per order.
 * Required: at least one SOURCE (DWG or DXF). Optional: PREVIEW (PDF / raster image).
 */

const CAD_DELIVERABLE_ROLES = Object.freeze({
  SOURCE: "source",
  PREVIEW: "preview",
});

const CAD_SOURCE_EXTENSIONS = Object.freeze([".dwg", ".dxf"]);
const CAD_PREVIEW_EXTENSIONS = Object.freeze([".pdf", ".png", ".jpg", ".jpeg", ".webp"]);

const CAD_SOURCE_MIME_TYPES = Object.freeze([
  "application/acad",
  "image/vnd.dwg",
  "application/x-autocad",
  "application/dxf",
  "image/vnd.dxf",
  "application/x-dxf",
  "application/octet-stream", // only with .dwg/.dxf extension
]);

const CAD_PREVIEW_MIME_TYPES = Object.freeze([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

/** Default max sizes (bytes). Override via env. */
const CAD_SOURCE_MAX_BYTES_DEFAULT = 50 * 1024 * 1024;
const CAD_PREVIEW_MAX_BYTES_DEFAULT = 15 * 1024 * 1024;

const CAD_DELIVERABLE_CONTRACT_VERSION = "CAD_DELIVERABLE_V1_DWG_DXF";

function fileExt(name) {
  const n = String(name || "").toLowerCase();
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i) : "";
}

function roleFromFile({ fileName, mimeType, role }) {
  if (role === CAD_DELIVERABLE_ROLES.SOURCE || role === CAD_DELIVERABLE_ROLES.PREVIEW) {
    return role;
  }
  const ext = fileExt(fileName);
  const ct = String(mimeType || "").toLowerCase();
  if (CAD_SOURCE_EXTENSIONS.includes(ext) || ct.includes("dwg") || ct.includes("dxf") || ct.includes("acad")) {
    return CAD_DELIVERABLE_ROLES.SOURCE;
  }
  if (CAD_PREVIEW_EXTENSIONS.includes(ext) || ct.includes("pdf") || ct.startsWith("image/")) {
    return CAD_DELIVERABLE_ROLES.PREVIEW;
  }
  return null;
}

module.exports = {
  CAD_DELIVERABLE_ROLES,
  CAD_SOURCE_EXTENSIONS,
  CAD_PREVIEW_EXTENSIONS,
  CAD_SOURCE_MIME_TYPES,
  CAD_PREVIEW_MIME_TYPES,
  CAD_SOURCE_MAX_BYTES_DEFAULT,
  CAD_PREVIEW_MAX_BYTES_DEFAULT,
  CAD_DELIVERABLE_CONTRACT_VERSION,
  fileExt,
  roleFromFile,
};
