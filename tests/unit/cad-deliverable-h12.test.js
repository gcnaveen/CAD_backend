/**
 * H-12: CAD deliverable contract (DWG/DXF source + preview).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertCadDeliverablePresignParams,
  assertCadDeliverableBundle,
} = require("../../src/services/cadDeliverableContract.service");

describe("H-12 CAD deliverable contract", () => {
  it("presign accepts DWG source", () => {
    const v = assertCadDeliverablePresignParams({
      fileName: "plan.dwg",
      contentType: "application/acad",
      fileSizeBytes: 1024,
      role: "source",
    });
    assert.equal(v.role, "source");
    assert.equal(v.contentType, "application/acad");
  });

  it("presign accepts DXF and PDF preview", () => {
    const dxf = assertCadDeliverablePresignParams({
      fileName: "a.dxf",
      contentType: "application/dxf",
      fileSizeBytes: 2048,
    });
    assert.equal(dxf.role, "source");
    const pdf = assertCadDeliverablePresignParams({
      fileName: "preview.pdf",
      contentType: "application/pdf",
      fileSizeBytes: 4096,
      role: "preview",
    });
    assert.equal(pdf.role, "preview");
  });

  it("presign rejects exe / missing size", () => {
    assert.throws(() =>
      assertCadDeliverablePresignParams({
        fileName: "x.exe",
        contentType: "application/octet-stream",
        fileSizeBytes: 10,
      })
    );
    assert.throws(() =>
      assertCadDeliverablePresignParams({
        fileName: "a.dwg",
        contentType: "application/acad",
      })
    );
  });

  it("bundle requires confirmed source DWG/DXF", () => {
    process.env.CAD_DELIVERABLE_REQUIRE_CONFIRM = "true";
    assert.throws(
      () =>
        assertCadDeliverableBundle([
          {
            url: "https://bucket/x.pdf",
            fileName: "only.pdf",
            mimeType: "application/pdf",
            confirmed: true,
          },
        ]),
      (err) => err.code === "CAD_SOURCE_REQUIRED"
    );

    assert.throws(
      () =>
        assertCadDeliverableBundle([
          {
            url: "https://bucket/a.dwg",
            fileName: "a.dwg",
            mimeType: "application/acad",
            role: "source",
            confirmed: false,
          },
        ]),
      (err) => err.code === "CAD_SOURCE_CONFIRM_REQUIRED"
    );

    const ok = assertCadDeliverableBundle([
      {
        url: "https://bucket/a.dwg",
        fileName: "a.dwg",
        mimeType: "application/acad",
        role: "source",
        confirmed: true,
        sha256: "abc",
        s3Key: "uploads/cad-deliverables/user/1/misc/a.dwg",
      },
      {
        url: "https://bucket/p.pdf",
        fileName: "p.pdf",
        mimeType: "application/pdf",
        role: "preview",
        confirmed: true,
      },
    ]);
    assert.equal(ok.sourceCount, 1);
    assert.equal(ok.previewCount, 1);
  });
});
