/**
 * File content safeguards (audit H-07): magic-byte / DWG header checks + optional AV hook.
 */

const { BadRequestError } = require("../utils/errors");

/** Known file signatures (offset 0 unless noted). */
const SIGNATURES = [
  { mime: "image/png", ext: [".png"], magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: "image/jpeg", ext: [".jpg", ".jpeg"], magic: Buffer.from([0xff, 0xd8, 0xff]) },
  { mime: "image/gif", ext: [".gif"], magic: Buffer.from("GIF8", "ascii") },
  { mime: "image/webp", ext: [".webp"], magic: Buffer.from("RIFF", "ascii"), secondary: Buffer.from("WEBP", "ascii"), secondaryOffset: 8 },
  { mime: "application/pdf", ext: [".pdf"], magic: Buffer.from("%PDF", "ascii") },
  // AutoCAD DWG — version string at offset 0 e.g. AC1015, AC1032
  { mime: "application/acad", ext: [".dwg"], magic: Buffer.from("AC10", "ascii"), dwg: true },
  { mime: "image/vnd.dwg", ext: [".dwg"], magic: Buffer.from("AC10", "ascii"), dwg: true },
  // DXF — ASCII (0/SECTION) or binary header; validated in isDxfHeader
  { mime: "application/dxf", ext: [".dxf"], dxf: true },
  { mime: "image/vnd.dxf", ext: [".dxf"], dxf: true },
];

const AUDIO_SIGNATURES = [
  { mime: "audio/mpeg", magic: Buffer.from([0xff, 0xfb]) },
  { mime: "audio/mpeg", magic: Buffer.from([0xff, 0xfa]) },
  { mime: "audio/mpeg", magic: Buffer.from([0xff, 0xf3]) },
  { mime: "audio/mpeg", magic: Buffer.from([0xff, 0xf2]) },
  { mime: "audio/mpeg", magic: Buffer.from("ID3", "ascii") },
  { mime: "audio/wav", magic: Buffer.from("RIFF", "ascii") },
  { mime: "audio/ogg", magic: Buffer.from("OggS", "ascii") },
  { mime: "audio/webm", magic: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
];

function isIsoBmffAudio(buf) {
  // MP4 / M4A: size(4) + "ftyp" at offset 4
  if (!Buffer.isBuffer(buf) || buf.length < 12) return false;
  return buf.subarray(4, 8).toString("ascii") === "ftyp";
}

function bufferStartsWith(buf, magic, offset = 0) {
  if (!Buffer.isBuffer(buf) || buf.length < offset + magic.length) return false;
  return buf.subarray(offset, offset + magic.length).equals(magic);
}

function isDwgHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 6) return false;
  if (!bufferStartsWith(buf, Buffer.from("AC", "ascii"))) return false;
  // AC10xx … AC1032 etc.
  const ver = buf.subarray(0, 6).toString("ascii");
  return /^AC10\d{2}$/.test(ver);
}

/** ASCII DXF starts with group 0 / SECTION; binary DXF has a fixed banner. */
function isDxfHeader(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  const head = buf.subarray(0, Math.min(buf.length, 96)).toString("latin1");
  if (head.startsWith("AutoCAD Binary DXF")) return true;
  const normalized = head.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/^\s*0\s*\n\s*SECTION\b/i.test(normalized)) return true;
  // Some exporters start with a comment group 999
  if (/^\s*999\s*\n/.test(normalized) && /\n\s*0\s*\n\s*SECTION\b/i.test(normalized)) return true;
  return false;
}

/**
 * Validate raw header bytes against declared MIME / filename.
 * @returns {{ ok: true, detected: string } | { ok: false, reason: string, code: string }}
 */
function validateFileHeader(bytes, { contentType, fileName } = {}) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (buf.length < 4) {
    return { ok: false, reason: "File header too short", code: "FILE_HEADER_TOO_SHORT" };
  }

  const ct = String(contentType || "").toLowerCase().trim();
  const name = String(fileName || "").toLowerCase();
  const ext = name.includes(".") ? `.${name.split(".").pop()}` : "";

  if (ext === ".dwg" || ct.includes("dwg") || ct.includes("acad")) {
    if (!isDwgHeader(buf)) {
      return { ok: false, reason: "Invalid DWG header (expected AC10xx)", code: "DWG_HEADER_INVALID" };
    }
    return { ok: true, detected: "application/acad" };
  }

  if (ext === ".dxf" || ct.includes("dxf")) {
    if (!isDxfHeader(buf)) {
      return { ok: false, reason: "Invalid DXF header (expected SECTION or binary DXF)", code: "DXF_HEADER_INVALID" };
    }
    return { ok: true, detected: "application/dxf" };
  }

  const candidates = [...SIGNATURES, ...AUDIO_SIGNATURES];
  for (const sig of candidates) {
    if (!sig.magic || sig.dxf) continue;
    if (!bufferStartsWith(buf, sig.magic)) continue;
    if (sig.secondary && !bufferStartsWith(buf, sig.secondary, sig.secondaryOffset || 0)) continue;
    if (sig.dwg && !isDwgHeader(buf)) continue;
    // If client declared a type, require match family
    if (ct && sig.mime && !ctIncludes(ct, sig.mime) && !(sig.ext || []).some((e) => ext === e)) {
      // allow jpeg/jpg alias
      if (!(ct.includes("jpeg") && sig.mime.includes("jpeg"))) {
        continue;
      }
    }
    return { ok: true, detected: sig.mime };
  }

  // Declared type with matching magic from list by mime preference
  for (const sig of SIGNATURES) {
    if (!sig.magic || sig.dxf) continue;
    if (ctIncludes(ct, sig.mime) || (sig.ext || []).includes(ext)) {
      if (bufferStartsWith(buf, sig.magic)) {
        if (sig.secondary && !bufferStartsWith(buf, sig.secondary, sig.secondaryOffset || 0)) {
          return { ok: false, reason: "MIME/extension mismatch with file bytes", code: "FILE_SIGNATURE_MISMATCH" };
        }
        return { ok: true, detected: sig.mime };
      }
      return { ok: false, reason: "MIME/extension mismatch with file bytes", code: "FILE_SIGNATURE_MISMATCH" };
    }
  }

  // Audio / voice-note fallback (MediaRecorder webm, Safari m4a)
  const looksAudio =
    ct.startsWith("audio/") ||
    ct === "video/webm" ||
    [".webm", ".mp3", ".mpeg", ".wav", ".ogg", ".m4a", ".mp4"].includes(ext);
  if (looksAudio) {
    for (const sig of AUDIO_SIGNATURES) {
      if (bufferStartsWith(buf, sig.magic)) {
        return { ok: true, detected: sig.mime };
      }
    }
    if (isIsoBmffAudio(buf)) {
      return { ok: true, detected: "audio/mp4" };
    }
  }

  return { ok: false, reason: "Unrecognized or disallowed file signature", code: "FILE_SIGNATURE_UNKNOWN" };
}

function ctIncludes(ct, mime) {
  return ct === mime || ct.startsWith(mime) || (mime === "image/jpeg" && (ct === "image/jpg" || ct.includes("jpeg")));
}

/**
 * Optional remote AV (ClamAV REST / vendor). If unset, signature-only mode.
 * @returns {Promise<{ clean: boolean, engine: string, detail?: string }>}
 */
async function runAntivirusScan({ key, contentType, fileName, headerBytes }) {
  const endpoint = String(process.env.CLAMAV_SCAN_URL || process.env.AV_SCAN_URL || "").trim();
  if (!endpoint) {
    const header = validateFileHeader(headerBytes, { contentType, fileName });
    if (!header.ok) {
      return { clean: false, engine: "signature-only", detail: header.reason, code: header.code };
    }
    return { clean: true, engine: "signature-only", detail: "No CLAMAV_SCAN_URL; magic-byte check passed" };
  }

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key,
        contentType,
        fileName,
        headerHex: Buffer.isBuffer(headerBytes) ? headerBytes.toString("hex") : "",
      }),
      signal: AbortSignal.timeout(Number(process.env.AV_SCAN_TIMEOUT_MS || 15000)),
    });
    if (!res.ok) {
      return { clean: false, engine: "clamav-http", detail: `AV HTTP ${res.status}` };
    }
    const body = await res.json().catch(() => ({}));
    const clean = body.clean === true || body.status === "OK" || body.Result === "OK";
    return { clean, engine: "clamav-http", detail: body.detail || body.message || null };
  } catch (err) {
    return { clean: false, engine: "clamav-http", detail: err.message || "AV scan failed" };
  }
}

function assertValidHeaderOrThrow(bytes, meta) {
  const r = validateFileHeader(bytes, meta);
  if (!r.ok) {
    throw new BadRequestError(r.reason, { code: r.code || "FILE_SIGNATURE_INVALID" });
  }
  return r;
}

/** Watermark policy — server records requirement; rasterization is CAD-client / offline. */
function getWatermarkPolicy() {
  return {
    required: String(process.env.WATERMARK_REQUIRED || "true").toLowerCase() !== "false",
    mode: process.env.WATERMARK_MODE || "CLIENT_SIDE_ON_EXPORT",
    notice:
      "CAD deliverables must carry surveyor/order watermark on export per North-cot policy. Server issues short-lived URLs only.",
  };
}

module.exports = {
  validateFileHeader,
  isDwgHeader,
  isDxfHeader,
  runAntivirusScan,
  assertValidHeaderOrThrow,
  getWatermarkPolicy,
  SIGNATURES,
};
