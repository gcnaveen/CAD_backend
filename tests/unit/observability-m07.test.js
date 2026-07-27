/**
 * M-07: request context + logger correlation / redaction.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  runWithRequestContext,
  getCorrelationId,
  extractIncomingCorrelationId,
  newCorrelationId,
} = require("../../src/utils/requestContext");
const logger = require("../../src/utils/logger");

describe("M-07 request context + logger", () => {
  it("extracts or generates correlation id", () => {
    const fromHeader = extractIncomingCorrelationId({
      headers: { "x-correlation-id": "abc-123" },
    });
    assert.equal(fromHeader, "abc-123");
    const generated = extractIncomingCorrelationId({ headers: {} });
    assert.ok(generated.length >= 8);
    assert.ok(newCorrelationId().length >= 8);
  });

  it("ALS exposes correlation id inside runWithRequestContext", async () => {
    await runWithRequestContext({ correlationId: "corr-test-1" }, async () => {
      assert.equal(getCorrelationId(), "corr-test-1");
    });
    assert.equal(getCorrelationId(), null);
  });

  it("logger.error accepts Error or meta object", () => {
    assert.doesNotThrow(() => logger.error("plain"));
    assert.doesNotThrow(() => logger.error("with err", new Error("boom"), { a: 1 }));
    assert.doesNotThrow(() => logger.error("with meta only", { token: "secret", path: "/x" }));
  });
});
