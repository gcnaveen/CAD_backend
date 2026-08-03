/**
 * BIZ-10: booking payment gate + terminal review transitions.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  isSketchBookingPaymentSatisfied,
  assertSketchBookingPaymentAllowsWorkflow,
} = require("../../src/services/sketchPaymentGate.service");
const { SURVEY_SKETCH_STATUS } = require("../../src/config/constants");
const { assertSketchStatusTransition } = require("../../src/config/lifecycleQcSpec");
const { BadRequestError } = require("../../src/utils/errors");

describe("BIZ-10 payment gate", () => {
  it("allows fee-zero PENDING uploads", () => {
    const upload = { status: SURVEY_SKETCH_STATUS.PENDING, sketchPayment: { status: "NONE", amountPaise: 0 } };
    assert.equal(isSketchBookingPaymentSatisfied(upload), true);
    assert.equal(assertSketchBookingPaymentAllowsWorkflow(upload), true);
  });

  it("blocks PAYMENT_PENDING", () => {
    const upload = {
      status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
      sketchPayment: { status: "PENDING", amountPaise: 10000 },
    };
    assert.throws(
      () => assertSketchBookingPaymentAllowsWorkflow(upload, { action: "assign" }),
      (err) => err instanceof BadRequestError && err.code === "SKETCH_PAYMENT_PENDING"
    );
  });

  it("blocks PENDING with unpaid amountPaise > 0", () => {
    const upload = {
      status: SURVEY_SKETCH_STATUS.PENDING,
      sketchPayment: { status: "PENDING", amountPaise: 10000 },
    };
    assert.throws(
      () => assertSketchBookingPaymentAllowsWorkflow(upload),
      (err) => err instanceof BadRequestError && err.code === "SKETCH_PAYMENT_INCOMPLETE"
    );
  });

  it("allows PENDING after COMPLETED booking", () => {
    const upload = {
      status: SURVEY_SKETCH_STATUS.PENDING,
      sketchPayment: { status: "COMPLETED", amountPaise: 10000 },
    };
    assert.equal(assertSketchBookingPaymentAllowsWorkflow(upload), true);
  });
});

describe("BIZ-10 terminal review transitions", () => {
  it("allows CAD_DELIVERED → APPROVED and → REJECTED", () => {
    assert.doesNotThrow(() =>
      assertSketchStatusTransition(SURVEY_SKETCH_STATUS.CAD_DELIVERED, SURVEY_SKETCH_STATUS.APPROVED)
    );
    assert.doesNotThrow(() =>
      assertSketchStatusTransition(SURVEY_SKETCH_STATUS.CAD_DELIVERED, SURVEY_SKETCH_STATUS.REJECTED)
    );
  });

  it("allows PAYMENT_PENDING → REJECTED (cancel unpaid)", () => {
    assert.doesNotThrow(() =>
      assertSketchStatusTransition(SURVEY_SKETCH_STATUS.PAYMENT_PENDING, SURVEY_SKETCH_STATUS.REJECTED)
    );
  });

  it("forbids APPROVED → ASSIGNED", () => {
    assert.throws(() =>
      assertSketchStatusTransition(SURVEY_SKETCH_STATUS.APPROVED, SURVEY_SKETCH_STATUS.ASSIGNED)
    );
  });
});
