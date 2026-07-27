/**
 * M-08: lifecycle transitions + QC matrix (canonical spec).
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  assertSketchStatusTransition,
  assertAssignmentStatusTransition,
  normalizeSketchStatus,
  assertQcRequiredForRelease,
  requiresQcForOrderType,
  ORDER_TYPES,
  QC_CHECKLIST_11E,
  getLifecycleQcPublicSpec,
  SKETCH_TRANSITIONS,
} = require("../../src/config/lifecycleQcSpec");
const { SURVEY_SKETCH_STATUS, SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../../src/config/constants");
const { getApprovedBusinessRulesPublic } = require("../../src/config/businessRulesBaseline");

describe("M-08 lifecycle + QC", () => {
  it("normalizes legacy UNDER_REVIEW and handoff aliases", () => {
    assert.equal(normalizeSketchStatus("UNDER_REVIEW"), SURVEY_SKETCH_STATUS.UNDER_REVISION);
    assert.equal(normalizeSketchStatus("QUEUED"), SURVEY_SKETCH_STATUS.PENDING);
    assert.equal(normalizeSketchStatus("DELIVERED"), SURVEY_SKETCH_STATUS.CAD_DELIVERED);
    assert.equal(normalizeSketchStatus("COMPLETED"), SURVEY_SKETCH_STATUS.APPROVED);
  });

  it("allows valid sketch transitions and rejects invalid", () => {
    assert.doesNotThrow(() =>
      assertSketchStatusTransition(
        SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
        SURVEY_SKETCH_STATUS.PENDING
      )
    );
    assert.doesNotThrow(() =>
      assertSketchStatusTransition(SURVEY_SKETCH_STATUS.ASSIGNED, SURVEY_SKETCH_STATUS.CAD_DELIVERED)
    );
    assert.throws(
      () =>
        assertSketchStatusTransition(
          SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
          SURVEY_SKETCH_STATUS.CAD_DELIVERED
        ),
      (err) => err.code === "INVALID_SKETCH_TRANSITION"
    );
    assert.throws(
      () =>
        assertSketchStatusTransition(SURVEY_SKETCH_STATUS.APPROVED, SURVEY_SKETCH_STATUS.PENDING),
      (err) => err.code === "INVALID_SKETCH_TRANSITION"
    );
  });

  it("rejects invalid assignment transitions", () => {
    assert.throws(
      () =>
        assertAssignmentStatusTransition(
          SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
          SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED
        ),
      (err) => err.code === "INVALID_ASSIGNMENT_TRANSITION"
    );
    assert.doesNotThrow(() =>
      assertAssignmentStatusTransition(
        SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
        SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS
      )
    );
  });

  it("Express and Standard both require 10-point QC (no bypass)", () => {
    assert.equal(QC_CHECKLIST_11E.length, 10);
    assert.equal(requiresQcForOrderType(ORDER_TYPES.STANDARD_11E), true);
    assert.equal(requiresQcForOrderType(ORDER_TYPES.EXPRESS_11E), true);
    const gate = assertQcRequiredForRelease(ORDER_TYPES.EXPRESS_11E);
    assert.equal(gate.expressBypassQc, false);
    assert.equal(gate.checkCount, 10);
  });

  it("public business rules embed the same machine", () => {
    const rules = getApprovedBusinessRulesPublic();
    const spec = getLifecycleQcPublicSpec();
    assert.equal(rules.qc.checkCount, 10);
    assert.equal(rules.qc.expressBypassQc, false);
    assert.equal(rules.lifecycleQcSpecId, spec.specId);
    assert.ok(rules.lifecycleMachine.sketchStatuses.length === 7);
    assert.ok(rules.lifecycleMachine.legacySketchStatusMap.UNDER_REVIEW);
    assert.ok(Array.isArray(SKETCH_TRANSITIONS[SURVEY_SKETCH_STATUS.PENDING]));
  });
});
