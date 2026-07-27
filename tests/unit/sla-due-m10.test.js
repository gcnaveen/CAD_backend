/**
 * M-10: clock-controlled SLA dueAt, pause, extension, states.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const slaDue = require("../../src/services/slaDue.service");
const { SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../../src/config/constants");

describe("M-10 SLA dueAt", () => {
  before(() => {
    slaDue.setNowProvider(() => new Date("2026-07-25T00:00:00.000Z"));
  });
  after(() => {
    slaDue.resetNowProvider();
  });

  it("sets dueAt = assignedAt + 48h", () => {
    const doc = { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED };
    slaDue.applySlaOnAssign(doc, { at: new Date("2026-07-25T00:00:00.000Z") });
    assert.equal(doc.dueAt.toISOString(), "2026-07-27T00:00:00.000Z");
    assert.equal(doc.slaDurationMs, 48 * 3600 * 1000);
    const snap = slaDue.buildSlaSnapshot(doc, { at: new Date("2026-07-25T12:00:00.000Z") });
    assert.equal(snap.state, slaDue.SLA_STATE.ON_TRACK);
    assert.equal(snap.dueAt, "2026-07-27T00:00:00.000Z");
  });

  it("pause extends effective due while ON_HOLD", () => {
    const doc = { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED };
    slaDue.applySlaOnAssign(doc, { at: new Date("2026-07-25T00:00:00.000Z") });
    slaDue.pauseSla(doc, { at: new Date("2026-07-25T10:00:00.000Z") });
    slaDue.resumeSla(doc, { at: new Date("2026-07-25T14:00:00.000Z") }); // +4h pause
    assert.equal(doc.slaPausedTotalMs, 4 * 3600 * 1000);
    assert.equal(doc.dueAt.toISOString(), "2026-07-27T04:00:00.000Z");
  });

  it("immutable extension adds to dueAt", () => {
    const doc = { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED };
    slaDue.applySlaOnAssign(doc, { at: new Date("2026-07-25T00:00:00.000Z") });
    slaDue.extendSla(doc, {
      ms: 6 * 3600 * 1000,
      reason: "test",
      by: null,
      at: new Date("2026-07-25T01:00:00.000Z"),
    });
    assert.equal(doc.slaExtensions.length, 1);
    assert.equal(doc.dueAt.toISOString(), "2026-07-27T06:00:00.000Z");
  });

  it("warning / escalate / breach by remaining time", () => {
    const doc = { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS };
    slaDue.applySlaOnAssign(doc, { at: new Date("2026-07-25T00:00:00.000Z") });
    // 3h before due → escalated (default escalate window 4h)
    let snap = slaDue.buildSlaSnapshot(doc, { at: new Date("2026-07-26T21:00:00.000Z") });
    assert.equal(snap.state, slaDue.SLA_STATE.ESCALATED);
    // after due → breached
    snap = slaDue.buildSlaSnapshot(doc, { at: new Date("2026-07-27T01:00:00.000Z") });
    assert.equal(snap.state, slaDue.SLA_STATE.BREACHED);
  });

  it("awaiting assignment has null dueAt", () => {
    const snap = slaDue.buildSlaSnapshot(null);
    assert.equal(snap.state, slaDue.SLA_STATE.AWAITING_ASSIGNMENT);
    assert.equal(snap.dueAt, null);
  });
});
