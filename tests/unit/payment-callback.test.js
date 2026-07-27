/**
 * H-04: payment amount match + callback idempotency (mocked PaymentAttempt).
 */
const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  assertPaidMatchesExpected,
  extractPaidAmountPaise,
} = require("../../src/services/phonePeSketchPayment.service");
const {
  applyProviderCallback,
  sanitizeProviderReference,
  PROVIDER_STATE,
} = require("../../src/services/paymentAttempt.service");
const PaymentAttempt = require("../../src/models/payment/PaymentAttempt");
const { rejectClientSketchPaymentAmount } = require("../../src/middleware/validator");

describe("payment: amount matching", () => {
  it("extracts paid paise from nested payload", () => {
    assert.equal(extractPaidAmountPaise({ data: { amount: 50000 } }), 50000);
  });

  it("accepts exact match", () => {
    const r = assertPaidMatchesExpected(50000, { amount: 50000 });
    assert.equal(r.ok, true);
    assert.equal(r.paidPaise, 50000);
  });

  it("rejects mismatch / missing", () => {
    assert.equal(assertPaidMatchesExpected(50000, { amount: 1 }).ok, false);
    assert.equal(assertPaidMatchesExpected(50000, { amount: 1 }).reason, "AMOUNT_MISMATCH");
    assert.equal(assertPaidMatchesExpected(50000, {}).reason, "MISSING_PAID_AMOUNT");
    assert.equal(assertPaidMatchesExpected(null, { amount: 1 }).reason, "MISSING_EXPECTED_AMOUNT");
  });
});

describe("payment: client amount rejected (C-01)", () => {
  it("rejects amount / amountRupees / amountPaise", () => {
    for (const body of [{ amount: 100 }, { amountRupees: 100 }, { amountPaise: 10000 }]) {
      assert.throws(() => rejectClientSketchPaymentAmount(body), (err) => err.code === "CLIENT_AMOUNT_NOT_ALLOWED");
    }
  });
  it("allows body without amount fields", () => {
    assert.doesNotThrow(() => rejectClientSketchPaymentAmount({ uploadId: "x" }));
  });
});

describe("payment: sanitizeProviderReference", () => {
  it("omits secrets and keeps audit fields", () => {
    const ref = sanitizeProviderReference(
      {
        state: "COMPLETED",
        amount: 1000,
        transactionId: "txn1",
        authorization: "secret",
        accessToken: "tok",
      },
      "MO1"
    );
    assert.equal(ref.merchantOrderId, "MO1");
    assert.equal(ref.transactionId, "txn1");
    assert.equal(ref.amountPaise, 1000);
    assert.equal(ref.authorization, undefined);
    assert.equal(ref.accessToken, undefined);
  });
});

describe("payment: applyProviderCallback idempotency", () => {
  let origFind;
  let saves;

  function makeAttempt(overrides = {}) {
    const doc = {
      merchantOrderId: "MO-IDEMP",
      surveyorSketchUpload: "507f1f77bcf86cd799439011",
      expectedAmountPaise: 40000,
      providerState: PROVIDER_STATE.PENDING,
      paidAmountPaise: null,
      reconciliationFlags: [],
      async save() {
        saves.push({ ...doc, providerState: doc.providerState, paidAmountPaise: doc.paidAmountPaise });
        return doc;
      },
      ...overrides,
    };
    return doc;
  }

  beforeEach(() => {
    saves = [];
    origFind = PaymentAttempt.findOne;
  });
  afterEach(() => {
    PaymentAttempt.findOne = origFind;
  });

  it("returns UNKNOWN when attempt missing", async () => {
    PaymentAttempt.findOne = async () => null;
    const r = await applyProviderCallback({
      merchantOrderId: "missing",
      phonepeResponse: { amount: 1 },
      completed: true,
      assertPaidMatchesExpected,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "UNKNOWN_PAYMENT_ATTEMPT");
  });

  it("completes on first success callback", async () => {
    const attempt = makeAttempt();
    PaymentAttempt.findOne = async () => attempt;
    const r = await applyProviderCallback({
      merchantOrderId: "MO-IDEMP",
      phonepeResponse: { state: "COMPLETED", amount: 40000 },
      completed: true,
      assertPaidMatchesExpected,
    });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyTerminal, false);
    assert.equal(attempt.providerState, PROVIDER_STATE.COMPLETED);
    assert.equal(attempt.paidAmountPaise, 40000);
  });

  it("is idempotent on second COMPLETED callback", async () => {
    const attempt = makeAttempt({
      providerState: PROVIDER_STATE.COMPLETED,
      paidAmountPaise: 40000,
    });
    PaymentAttempt.findOne = async () => attempt;
    const r = await applyProviderCallback({
      merchantOrderId: "MO-IDEMP",
      phonepeResponse: { state: "COMPLETED", amount: 40000 },
      completed: true,
      assertPaidMatchesExpected,
    });
    assert.equal(r.ok, true);
    assert.equal(r.alreadyTerminal, true);
    assert.equal(r.paidPaise, 40000);
  });

  it("flags AMOUNT_MISMATCH without completing", async () => {
    const attempt = makeAttempt();
    PaymentAttempt.findOne = async () => attempt;
    const r = await applyProviderCallback({
      merchantOrderId: "MO-IDEMP",
      phonepeResponse: { state: "COMPLETED", amount: 1 },
      completed: true,
      assertPaidMatchesExpected,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "AMOUNT_MISMATCH");
    assert.equal(attempt.providerState, PROVIDER_STATE.AMOUNT_MISMATCH);
  });
});
