/**
 * H-04 / H-10: upload validation (MIME / size / extension).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  validateImageUpload,
  validateAudioUpload,
} = require("../../src/services/upload.service");
const {
  UPLOAD_IMAGE_MAX_BYTES,
  UPLOAD_AUDIO_MAX_BYTES,
} = require("../../src/config/constants");
const { UnauthorizedError } = require("../../src/utils/errors");

describe("upload: validateImageUpload", () => {
  it("accepts png/jpeg/pdf", () => {
    assert.equal(
      validateImageUpload({ fileName: "a.png", contentType: "image/png", fileSizeBytes: 100 }).contentType,
      "image/png"
    );
    assert.equal(
      validateImageUpload({ fileName: "a.jpg", contentType: "image/jpeg", fileSizeBytes: 100 }).contentType,
      "image/jpeg"
    );
    assert.equal(
      validateImageUpload({ fileName: "a.pdf", contentType: "application/pdf", fileSizeBytes: 100 }).contentType,
      "application/pdf"
    );
  });

  it("infers pdf from extension when octet-stream", () => {
    assert.equal(
      validateImageUpload({
        fileName: "doc.pdf",
        contentType: "application/octet-stream",
        fileSizeBytes: 50,
      }).contentType,
      "application/pdf"
    );
  });

  it("rejects missing name / bad mime / oversized / missing size / bad extension", () => {
    assert.throws(() => validateImageUpload({ fileName: "", contentType: "image/png", fileSizeBytes: 1 }));
    assert.throws(() =>
      validateImageUpload({ fileName: "x.exe", contentType: "application/x-msdownload", fileSizeBytes: 1 })
    );
    assert.throws(() =>
      validateImageUpload({
        fileName: "big.png",
        contentType: "image/png",
        fileSizeBytes: UPLOAD_IMAGE_MAX_BYTES + 1,
      })
    );
    assert.throws(() => validateImageUpload({ fileName: "a.png", contentType: "image/png" }));
  });
});

describe("upload: validateAudioUpload", () => {
  it("accepts mp3/wav", () => {
    assert.equal(
      validateAudioUpload({ fileName: "a.mp3", contentType: "audio/mpeg", fileSizeBytes: 100 }).contentType,
      "audio/mpeg"
    );
    assert.equal(
      validateAudioUpload({ fileName: "a.wav", contentType: "audio/wav", fileSizeBytes: 100 }).contentType,
      "audio/wav"
    );
  });

  it("strips MediaRecorder codec params and maps video/webm", () => {
    assert.equal(
      validateAudioUpload({
        fileName: "blob",
        contentType: "audio/webm;codecs=opus",
        fileSizeBytes: 100,
      }).contentType,
      "audio/webm"
    );
    assert.equal(
      validateAudioUpload({
        fileName: "recording",
        contentType: "video/webm;codecs=opus",
        fileSizeBytes: 100,
      }).contentType,
      "audio/webm"
    );
    assert.match(
      validateAudioUpload({
        fileName: "blob",
        contentType: "audio/webm",
        fileSizeBytes: 100,
      }).fileName,
      /\.webm$/
    );
  });

  it("rejects bad mime / oversized / missing size", () => {
    assert.throws(() => validateAudioUpload({ fileName: "a.txt", contentType: "text/plain", fileSizeBytes: 1 }));
    assert.throws(() =>
      validateAudioUpload({
        fileName: "a.mp3",
        contentType: "audio/mpeg",
        fileSizeBytes: UPLOAD_AUDIO_MAX_BYTES + 1,
      })
    );
    assert.throws(() => validateAudioUpload({ fileName: "a.mp3", contentType: "audio/mpeg" }));
  });
});

describe("upload: auth gate", () => {
  it("presign without user is 401", async () => {
    const { getImageUploadUrl } = require("../../src/services/upload.service");
    await assert.rejects(
      () =>
        getImageUploadUrl(
          { fileName: "a.png", contentType: "image/png", fileSizeBytes: 100 },
          null
        ),
      (err) => err instanceof UnauthorizedError && err.statusCode === 401
    );
  });
});
