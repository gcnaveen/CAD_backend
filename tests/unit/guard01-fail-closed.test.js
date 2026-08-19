/**
 * N3 / GUARD-01: fail closed when upload/assignment cannot be loaded.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  requireLoadedUpload,
  requireLoadedAssignment,
} = require("../../src/services/requireLoadedRecord");
const {
  assertSketchBookingPaymentAllowsWorkflow,
} = require("../../src/services/sketchPaymentGate.service");
const {
  applySketchStatus,
  applyAssignmentStatus,
} = require("../../src/config/lifecycleQcSpec");
const { SURVEY_SKETCH_STATUS, SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../../src/config/constants");
const { NotFoundError, BadRequestError } = require("../../src/utils/errors");

describe("N3 / GUARD-01 fail closed", () => {
  it("missing upload → payment gate throws", () => {
    assert.throws(
      () => requireLoadedUpload(null),
      (e) => e instanceof NotFoundError && e.code === "SURVEY_SKETCH_NOT_FOUND"
    );
    assert.throws(
      () => assertSketchBookingPaymentAllowsWorkflow(null, { action: "assign" }),
      (e) => e instanceof BadRequestError && e.code === "SKETCH_PAYMENT_GATE_NO_UPLOAD"
    );
    assert.throws(
      () => applySketchStatus(null, SURVEY_SKETCH_STATUS.ASSIGNED),
      (e) => e instanceof NotFoundError && e.code === "SURVEY_SKETCH_NOT_FOUND"
    );
  });

  it("missing assignment → status transition throws", () => {
    assert.throws(
      () => requireLoadedAssignment(undefined),
      (e) => e instanceof NotFoundError && e.code === "ASSIGNMENT_NOT_FOUND"
    );
    assert.throws(
      () => applyAssignmentStatus(null, SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS),
      (e) => e instanceof NotFoundError && e.code === "ASSIGNMENT_NOT_FOUND"
    );
  });

  it("existing unpaid path still blocks workflow", () => {
    const unpaid = {
      status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
      sketchPayment: { status: "PENDING", amountPaise: 10000 },
    };
    requireLoadedUpload(unpaid);
    assert.throws(
      () => assertSketchBookingPaymentAllowsWorkflow(unpaid, { action: "assign" }),
      (e) => e instanceof BadRequestError && e.code === "SKETCH_PAYMENT_PENDING"
    );
  });

  it("existing paid path still allows workflow", () => {
    const paid = {
      status: SURVEY_SKETCH_STATUS.PENDING,
      sketchPayment: { status: "COMPLETED", amountPaise: 10000 },
    };
    requireLoadedUpload(paid);
    assert.equal(assertSketchBookingPaymentAllowsWorkflow(paid, { action: "assign" }), true);
  });

  it("fee-zero path still allows workflow", () => {
    const waived = {
      status: SURVEY_SKETCH_STATUS.PENDING,
      sketchPayment: { status: "NONE", amountPaise: 0 },
    };
    assert.equal(assertSketchBookingPaymentAllowsWorkflow(waived), true);
  });
});
