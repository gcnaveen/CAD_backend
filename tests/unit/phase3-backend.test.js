/**
 * Phase-3 unit checks: COUNT-01 / OPS-01 / FILTER-01 helpers.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeStatusKey,
  emptyByStatus,
  toDashboardOrdersShape,
  canonicalStatusCodes,
} = require("../../src/services/orderStatusCounts.service");
const slaDue = require("../../src/services/slaDue.service");
const { SURVEY_SKETCH_STATUS } = require("../../src/config/constants");
const { getLifecycleQcPublicSpec } = require("../../src/config/lifecycleQcSpec");
const {
  assertSketchBookingPaymentAllowsWorkflow,
} = require("../../src/services/sketchPaymentGate.service");
const { BadRequestError } = require("../../src/utils/errors");

describe("COUNT-01 orderStatusCounts", () => {
  it("canonical codes include PAYMENT_PENDING once", () => {
    const codes = canonicalStatusCodes();
    assert.ok(codes.includes(SURVEY_SKETCH_STATUS.PAYMENT_PENDING));
    assert.equal(codes.filter((c) => c === SURVEY_SKETCH_STATUS.UNDER_REVISION).length, 1);
  });

  it("normalizes UNDER_REVIEW alias", () => {
    assert.equal(normalizeStatusKey("UNDER_REVIEW"), SURVEY_SKETCH_STATUS.UNDER_REVISION);
    assert.equal(normalizeStatusKey(null), null);
  });

  it("dashboard shape embeds total inside byStatus", () => {
    const byStatus = emptyByStatus();
    byStatus.PENDING = 2;
    byStatus.PAYMENT_PENDING = 1;
    const shaped = toDashboardOrdersShape({ total: 3, byStatus });
    assert.equal(shaped.totalOrders, 3);
    assert.equal(shaped.byStatus.total, 3);
    assert.equal(shaped.byStatus.PENDING, 2);
    assert.equal(shaped.byStatus.PAYMENT_PENDING, 1);
  });
});

describe("OPS-01 computeSlaAgingSummary", () => {
  it("counts live breaches matching buildSlaSnapshot", () => {
    slaDue.setNowProvider(() => new Date("2026-01-10T00:00:00.000Z"));
    const open = [
      {
        _id: "a1",
        status: "IN_PROGRESS",
        assignedAt: new Date("2026-01-01T00:00:00.000Z"),
        dueAt: new Date("2026-01-03T00:00:00.000Z"),
        slaDurationMs: 48 * 3600 * 1000,
        slaState: "ON_TRACK",
      },
      {
        _id: "a2",
        status: "IN_PROGRESS",
        assignedAt: new Date("2026-01-09T00:00:00.000Z"),
        dueAt: new Date("2026-01-11T00:00:00.000Z"),
        slaDurationMs: 48 * 3600 * 1000,
        slaState: "ON_TRACK",
      },
    ];
    const summary = slaDue.computeSlaAgingSummary(open);
    assert.equal(summary.breached, 1);
    assert.equal(summary.openCount, 2);
    assert.equal(summary.breached + summary.withinSla + summary.warning + summary.escalated + summary.paused, 2);
    const snap0 = slaDue.buildSlaSnapshot(open[0]);
    assert.equal(snap0.state, slaDue.SLA_STATE.BREACHED);
    slaDue.resetNowProvider();
  });
});

describe("FILTER-01 PAYMENT_PENDING catalog", () => {
  it("exposes value and code for PAYMENT_PENDING", () => {
    const spec = getLifecycleQcPublicSpec();
    const pending = spec.sketchStatuses.find((s) => s.code === "PAYMENT_PENDING");
    assert.ok(pending);
    assert.equal(pending.value, "PAYMENT_PENDING");
    assert.ok(spec.sketchStatuses.every((s) => s.value === s.code));
  });
});

describe("PAY-02 payment gate", () => {
  it("blocks workflow on PAYMENT_PENDING", () => {
    assert.throws(
      () =>
        assertSketchBookingPaymentAllowsWorkflow(
          { status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING },
          { action: "assign" }
        ),
      (err) => err instanceof BadRequestError && err.code === "SKETCH_PAYMENT_PENDING"
    );
  });
});
