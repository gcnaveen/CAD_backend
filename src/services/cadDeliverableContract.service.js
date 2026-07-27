/**
 * H-12: validate CAD deliverable bundles (source DWG/DXF + optional preview).
 */

const { BadRequestError } = require("../utils/errors");
const {
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
} = require("../config/cadDeliverableContract");

function sourceMaxBytes() {
  const n = Number(process.env.CAD_SOURCE_MAX_BYTES || CAD_SOURCE_MAX_BYTES_DEFAULT);
  return Number.isFinite(n) && n > 0 ? n : CAD_SOURCE_MAX_BYTES_DEFAULT;
}

function previewMaxBytes() {
  const n = Number(process.env.CAD_PREVIEW_MAX_BYTES || CAD_PREVIEW_MAX_BYTES_DEFAULT);
  return Number.isFinite(n) && n > 0 ? n : CAD_PREVIEW_MAX_BYTES_DEFAULT;
}

function assertCadDeliverablePresignParams(params) {
  const fileName = String(params.fileName || "").trim();
  if (!fileName) {
    throw new BadRequestError("fileName is required", {
      errors: [{ field: "fileName", message: "Required" }],
    });
  }
  const ext = fileExt(fileName);
  const role = roleFromFile({
    fileName,
    mimeType: params.contentType,
    role: params.role,
  });
  if (!role) {
    throw new BadRequestError(
      `Unsupported CAD deliverable extension. Source: ${CAD_SOURCE_EXTENSIONS.join(", ")}; preview: ${CAD_PREVIEW_EXTENSIONS.join(", ")}`,
      { code: "CAD_DELIVERABLE_TYPE_DENIED" }
    );
  }

  const ct = String(params.contentType || "").trim().toLowerCase();
  const maxBytes = role === CAD_DELIVERABLE_ROLES.SOURCE ? sourceMaxBytes() : previewMaxBytes();
  const size = Number(params.fileSizeBytes);
  if (!Number.isFinite(size) || size <= 0 || size > maxBytes) {
    throw new BadRequestError(
      `fileSizeBytes must be between 1 and ${maxBytes} for ${role} files`,
      { code: "CAD_DELIVERABLE_SIZE_INVALID", errors: [{ field: "fileSizeBytes", message: "Invalid size" }] }
    );
  }

  if (role === CAD_DELIVERABLE_ROLES.SOURCE) {
    if (!CAD_SOURCE_EXTENSIONS.includes(ext)) {
      throw new BadRequestError("Source deliverable must be .dwg or .dxf", {
        code: "CAD_SOURCE_EXTENSION_REQUIRED",
      });
    }
    if (ct && ct !== "application/octet-stream" && !CAD_SOURCE_MIME_TYPES.includes(ct)) {
      throw new BadRequestError(`Invalid source contentType for CAD deliverable`, {
        code: "CAD_SOURCE_MIME_DENIED",
      });
    }
  } else {
    if (!CAD_PREVIEW_EXTENSIONS.includes(ext)) {
      throw new BadRequestError("Preview must be PDF or image", { code: "CAD_PREVIEW_EXTENSION_REQUIRED" });
    }
    if (ct && ct !== "application/octet-stream" && !CAD_PREVIEW_MIME_TYPES.includes(ct)) {
      throw new BadRequestError("Invalid preview contentType", { code: "CAD_PREVIEW_MIME_DENIED" });
    }
  }

  let contentType = ct;
  if (!contentType || contentType === "application/octet-stream") {
    if (ext === ".dwg") contentType = "application/acad";
    else if (ext === ".dxf") contentType = "application/dxf";
    else if (ext === ".pdf") contentType = "application/pdf";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".webp") contentType = "image/webp";
  }

  return { fileName, role, contentType, fileSizeBytes: size, maxBytes, contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION };
}

/**
 * Validate files attached on deliver / deliver-revision.
 * Requires ≥1 confirmed source DWG/DXF.
 */
function assertCadDeliverableBundle(files) {
  const list = Array.isArray(files) ? files : [];
  if (!list.length) {
    throw new BadRequestError("At least one deliverable file is required", {
      code: "CAD_DELIVERABLE_REQUIRED",
    });
  }

  const normalized = list.map((file, index) => {
    const fileName = file.fileName != null ? String(file.fileName).trim() : "";
    const mimeType = file.mimeType != null ? String(file.mimeType).trim() : null;
    const role = roleFromFile({ fileName, mimeType, role: file.role });
    if (!role) {
      throw new BadRequestError(`files[${index}] has unsupported type for CAD deliverable`, {
        code: "CAD_DELIVERABLE_TYPE_DENIED",
      });
    }
    const ext = fileExt(fileName);
    if (role === CAD_DELIVERABLE_ROLES.SOURCE && !CAD_SOURCE_EXTENSIONS.includes(ext)) {
      throw new BadRequestError(`files[${index}] source must be .dwg or .dxf`, {
        code: "CAD_SOURCE_EXTENSION_REQUIRED",
      });
    }
    if (role === CAD_DELIVERABLE_ROLES.PREVIEW && !CAD_PREVIEW_EXTENSIONS.includes(ext)) {
      throw new BadRequestError(`files[${index}] preview must be PDF/image`, {
        code: "CAD_PREVIEW_EXTENSION_REQUIRED",
      });
    }
    return {
      url: String(file.url || "").trim(),
      fileName: fileName || null,
      mimeType,
      size: file.size != null && file.size !== "" ? Number(file.size) : null,
      role,
      sha256: file.sha256 != null ? String(file.sha256).trim() : null,
      s3Key: file.s3Key != null ? String(file.s3Key).trim() : file.key != null ? String(file.key).trim() : null,
      confirmed: file.confirmed === true || file.scanPassed === true,
      contractVersion: file.contractVersion || CAD_DELIVERABLE_CONTRACT_VERSION,
      uploadedAt: file.uploadedAt || new Date(),
    };
  });

  const sources = normalized.filter((f) => f.role === CAD_DELIVERABLE_ROLES.SOURCE);
  if (!sources.length) {
    throw new BadRequestError("At least one SOURCE deliverable (.dwg or .dxf) is required", {
      code: "CAD_SOURCE_REQUIRED",
    });
  }

  const requireConfirm = String(process.env.CAD_DELIVERABLE_REQUIRE_CONFIRM || "true").toLowerCase() !== "false";
  if (requireConfirm) {
    for (const f of sources) {
      if (!f.confirmed) {
        throw new BadRequestError(
          "Each SOURCE file must be confirmed via POST /api/upload/confirm before deliver",
          { code: "CAD_SOURCE_CONFIRM_REQUIRED" }
        );
      }
    }
  }

  return {
    files: normalized,
    contractVersion: CAD_DELIVERABLE_CONTRACT_VERSION,
    sourceCount: sources.length,
    previewCount: normalized.filter((f) => f.role === CAD_DELIVERABLE_ROLES.PREVIEW).length,
  };
}

module.exports = {
  assertCadDeliverablePresignParams,
  assertCadDeliverableBundle,
  sourceMaxBytes,
  previewMaxBytes,
};
