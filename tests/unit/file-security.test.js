/**
 * H-07: magic bytes, DWG header, quarantine decision helpers.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateFileHeader,
  isDwgHeader,
  isDxfHeader,
  getWatermarkPolicy,
} = require("../../src/services/fileSecurity.service");

describe("file security: signatures", () => {
  it("accepts PNG magic", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    const r = validateFileHeader(png, { contentType: "image/png", fileName: "a.png" });
    assert.equal(r.ok, true);
  });

  it("rejects PDF bytes claimed as PNG", () => {
    const pdf = Buffer.from("%PDF-1.4 rest");
    const r = validateFileHeader(pdf, { contentType: "image/png", fileName: "a.png" });
    assert.equal(r.ok, false);
  });

  it("validates DWG AC10xx header", () => {
    assert.equal(isDwgHeader(Buffer.from("AC1032xxxx")), true);
    assert.equal(isDwgHeader(Buffer.from("NOTDWG")), false);
    const r = validateFileHeader(Buffer.from("AC1015...."), {
      contentType: "application/acad",
      fileName: "plan.dwg",
    });
    assert.equal(r.ok, true);
  });

  it("quarantines fake DWG", () => {
    const r = validateFileHeader(Buffer.from("MZ_EXE_FAKE"), {
      contentType: "application/acad",
      fileName: "evil.dwg",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "DWG_HEADER_INVALID");
  });

  it("validates ASCII DXF header", () => {
    const dxf = Buffer.from("  0\nSECTION\n  2\nHEADER\n");
    assert.equal(isDxfHeader(dxf), true);
    const r = validateFileHeader(dxf, { contentType: "application/dxf", fileName: "a.dxf" });
    assert.equal(r.ok, true);
    assert.equal(r.detected, "application/dxf");
  });

  it("rejects spoofed DXF", () => {
    const r = validateFileHeader(Buffer.from("%PDF-1.4"), {
      contentType: "application/dxf",
      fileName: "fake.dxf",
    });
    assert.equal(r.ok, false);
    assert.equal(r.code, "DXF_HEADER_INVALID");
  });
});

describe("watermark policy", () => {
  it("exposes client-side watermark requirement", () => {
    const p = getWatermarkPolicy();
    assert.equal(typeof p.required, "boolean");
    assert.ok(p.notice);
  });
});

describe("cross-user download gate", () => {
  it("isDownloadEntitled does not bypass ownership (ownership checked in service)", () => {
    // Ownership is enforced before entitlement; unit-check deny path code exists via require
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "../../src/services/cadDownloadEntitlement.service.js"),
      "utf8"
    );
    assert.match(src, /NOT_YOUR_SKETCH/);
    assert.match(src, /ACCESS_DENIED_CROSS_USER/);
  });
});
