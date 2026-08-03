/**
 * B3: PhonePe redirect URLs required; never localhost.
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  getSuccessRedirectUrl,
  getFailureRedirectUrl,
  resolvePhonePeRedirectUrl,
} = require("../../src/services/phonePeSketchPayment.service");
const { BadRequestError } = require("../../src/utils/errors");

describe("B3 PhonePe redirect URLs", () => {
  const keys = [
    "PHONEPE_SUCCESS_REDIRECT_URL",
    "PHONEPE_FAILURE_REDIRECT_URL",
    "PHONEPE_ENV",
    "STAGE",
    "NODE_ENV",
  ];
  const prev = {};

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("throws PHONEPE_REDIRECT_URL_REQUIRED when unset", () => {
    assert.throws(
      () => getSuccessRedirectUrl(),
      (err) => err instanceof BadRequestError && err.code === "PHONEPE_REDIRECT_URL_REQUIRED"
    );
    assert.throws(
      () => getFailureRedirectUrl(),
      (err) => err instanceof BadRequestError && err.code === "PHONEPE_REDIRECT_URL_REQUIRED"
    );
  });

  it("rejects localhost URLs", () => {
    process.env.PHONEPE_SUCCESS_REDIRECT_URL = "http://localhost:5173/payment-success";
    assert.throws(
      () => resolvePhonePeRedirectUrl("PHONEPE_SUCCESS_REDIRECT_URL"),
      (err) => err instanceof BadRequestError && err.code === "PHONEPE_REDIRECT_LOCALHOST_FORBIDDEN"
    );
  });

  it("rejects http in PRODUCTION", () => {
    process.env.PHONEPE_ENV = "PRODUCTION";
    process.env.PHONEPE_SUCCESS_REDIRECT_URL = "http://north-cot.com/payment-success";
    assert.throws(
      () => getSuccessRedirectUrl(),
      (err) => err instanceof BadRequestError && err.code === "PHONEPE_REDIRECT_HTTPS_REQUIRED"
    );
  });

  it("accepts https North-Cot URLs", () => {
    process.env.PHONEPE_SUCCESS_REDIRECT_URL = "https://north-cot.com/payment-success";
    process.env.PHONEPE_FAILURE_REDIRECT_URL = "https://www.north-cot.com/payment-failure";
    assert.equal(getSuccessRedirectUrl(), "https://north-cot.com/payment-success");
    assert.equal(getFailureRedirectUrl(), "https://www.north-cot.com/payment-failure");
  });
});
