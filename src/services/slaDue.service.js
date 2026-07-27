/**
 * Server-owned delivery SLA / dueAt (audit M-10).
 * Public promise: 48-hour delivery after CAD assignment (UTC storage, IST display zone).
 */

const { SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../config/constants");

const SLA_STATE = Object.freeze({
  AWAITING_ASSIGNMENT: "AWAITING_ASSIGNMENT",
  ON_TRACK: "ON_TRACK",
  WARNING: "WARNING",
  ESCALATED: "ESCALATED",
  BREACHED: "BREACHED",
  PAUSED: "PAUSED",
  MET: "MET",
  CANCELLED: "CANCELLED",
});

const DISPLAY_TIMEZONE = "Asia/Kolkata";

/** Injectable clock for tests. */
let _nowProvider = () => new Date();

function setNowProvider(fn) {
  _nowProvider = typeof fn === "function" ? fn : () => new Date();
}

function resetNowProvider() {
  _nowProvider = () => new Date();
}

function now() {
  return new Date(_nowProvider());
}

function getStandardSlaMs() {
  const n = Number(process.env.CAD_DELIVERY_SLA_MS || 48 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 48 * 60 * 60 * 1000;
}

function getExpressSlaMs() {
  const n = Number(process.env.CAD_DELIVERY_SLA_EXPRESS_MS || 24 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}

function getWarningMs() {
  const n = Number(process.env.CAD_SLA_WARNING_MS || 12 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 12 * 60 * 60 * 1000;
}

function getEscalateMs() {
  const n = Number(process.env.CAD_SLA_ESCALATE_MS || 4 * 60 * 60 * 1000);
  return Number.isFinite(n) && n > 0 ? n : 4 * 60 * 60 * 1000;
}

function getSlaMsForOrderType(orderType) {
  if (String(orderType || "").toUpperCase() === "EXPRESS_11E") return getExpressSlaMs();
  return getStandardSlaMs();
}

function getPolicy() {
  return {
    standardSlaMs: getStandardSlaMs(),
    expressSlaMs: getExpressSlaMs(),
    warningMs: getWarningMs(),
    escalateMs: getEscalateMs(),
    displayTimezone: DISPLAY_TIMEZONE,
    publicPromise: "48-hour delivery after CAD assignment (Standard 11E)",
    pauseStatuses: [SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD],
    clockStatuses: [
      SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
      SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
      SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
    ],
  };
}

function sumExtensionsMs(extensions) {
  if (!Array.isArray(extensions)) return 0;
  return extensions.reduce((s, e) => s + (Number(e.ms) || 0), 0);
}

/**
 * Compute authoritative dueAt from clock fields.
 * dueAt = assignedAt + slaDurationMs + pausedTotalMs + extensions
 * (while paused, effective due slides further as pause continues — surfaced via remainingMs).
 */
function computeDueAt({
  assignedAt,
  slaDurationMs,
  pausedTotalMs = 0,
  slaPausedAt = null,
  extensions = [],
  at = null,
}) {
  const start = assignedAt ? new Date(assignedAt).getTime() : NaN;
  if (!Number.isFinite(start)) return null;
  const duration = Number(slaDurationMs) > 0 ? Number(slaDurationMs) : getStandardSlaMs();
  let paused = Number(pausedTotalMs) || 0;
  const t = (at || now()).getTime();
  if (slaPausedAt) {
    const pStart = new Date(slaPausedAt).getTime();
    if (Number.isFinite(pStart) && t > pStart) paused += t - pStart;
  }
  return new Date(start + duration + paused + sumExtensionsMs(extensions));
}

function resolveSlaState(assignment, { at = null } = {}) {
  const t = at || now();
  if (!assignment) {
    return {
      state: SLA_STATE.AWAITING_ASSIGNMENT,
      dueAt: null,
      remainingMs: null,
      ageMs: null,
      paused: false,
    };
  }

  const status = assignment.status;
  if (status === SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED) {
    return {
      state: SLA_STATE.CANCELLED,
      dueAt: assignment.dueAt || assignment.dueDate || null,
      remainingMs: null,
      ageMs: null,
      paused: false,
    };
  }

  const dueAt =
    assignment.dueAt ||
    computeDueAt({
      assignedAt: assignment.assignedAt,
      slaDurationMs: assignment.slaDurationMs,
      pausedTotalMs: assignment.slaPausedTotalMs,
      slaPausedAt: assignment.slaPausedAt,
      extensions: assignment.slaExtensions,
      at: t,
    });

  const assignedAt = assignment.assignedAt ? new Date(assignment.assignedAt) : null;
  const ageMs = assignedAt ? t.getTime() - assignedAt.getTime() : null;

  if (status === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
    const completedAt = assignment.completedAt ? new Date(assignment.completedAt) : t;
    const met = dueAt ? completedAt.getTime() <= new Date(dueAt).getTime() : true;
    return {
      state: met ? SLA_STATE.MET : SLA_STATE.BREACHED,
      dueAt,
      remainingMs: dueAt ? new Date(dueAt).getTime() - completedAt.getTime() : null,
      ageMs: assignedAt ? completedAt.getTime() - assignedAt.getTime() : null,
      paused: false,
    };
  }

  if (assignment.slaPausedAt || status === SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD) {
    const liveDue = computeDueAt({
      assignedAt: assignment.assignedAt,
      slaDurationMs: assignment.slaDurationMs || getStandardSlaMs(),
      pausedTotalMs: assignment.slaPausedTotalMs || 0,
      slaPausedAt: assignment.slaPausedAt || assignment.updatedAt || t,
      extensions: assignment.slaExtensions,
      at: t,
    });
    return {
      state: SLA_STATE.PAUSED,
      dueAt: liveDue,
      remainingMs: liveDue ? new Date(liveDue).getTime() - t.getTime() : null,
      ageMs,
      paused: true,
    };
  }

  if (!dueAt) {
    return {
      state: SLA_STATE.AWAITING_ASSIGNMENT,
      dueAt: null,
      remainingMs: null,
      ageMs,
      paused: false,
    };
  }

  const remainingMs = new Date(dueAt).getTime() - t.getTime();
  if (remainingMs <= 0) {
    return { state: SLA_STATE.BREACHED, dueAt, remainingMs, ageMs, paused: false };
  }
  if (remainingMs <= getEscalateMs()) {
    return { state: SLA_STATE.ESCALATED, dueAt, remainingMs, ageMs, paused: false };
  }
  if (remainingMs <= getWarningMs()) {
    return { state: SLA_STATE.WARNING, dueAt, remainingMs, ageMs, paused: false };
  }
  return { state: SLA_STATE.ON_TRACK, dueAt, remainingMs, ageMs, paused: false };
}

/**
 * Public SLA snapshot attached to assignment / order payloads (same for all roles).
 */
function buildSlaSnapshot(assignment, { at = null, orderType = null } = {}) {
  const policy = getPolicy();
  const resolved = resolveSlaState(assignment, { at });
  const dueAt = resolved.dueAt ? new Date(resolved.dueAt) : null;
  return {
    policyVersion: "M10-2026.07.25",
    timezone: DISPLAY_TIMEZONE,
    publicPromise: policy.publicPromise,
    orderType: orderType || "STANDARD_11E",
    slaDurationMs: assignment?.slaDurationMs || getSlaMsForOrderType(orderType),
    slaDurationHours: Math.round((assignment?.slaDurationMs || getSlaMsForOrderType(orderType)) / 3600000),
    clockStartedAt: assignment?.assignedAt || null,
    dueAt: dueAt ? dueAt.toISOString() : null,
    /** Legacy alias — always equals dueAt when set. */
    dueDate: dueAt ? dueAt.toISOString() : assignment?.dueDate || null,
    state: resolved.state,
    remainingMs: resolved.remainingMs,
    remainingHours:
      resolved.remainingMs == null ? null : Math.round(resolved.remainingMs / 3600000),
    ageMs: resolved.ageMs,
    ageHours: resolved.ageMs == null ? null : Math.round(resolved.ageMs / 3600000),
    paused: resolved.paused,
    pausedTotalMs: assignment?.slaPausedTotalMs || 0,
    extensions: Array.isArray(assignment?.slaExtensions)
      ? assignment.slaExtensions.map((e) => ({
          at: e.at,
          ms: e.ms,
          reason: e.reason,
          by: e.by,
        }))
      : [],
    riskRank: slaRiskRank(resolved.state),
  };
}

function slaRiskRank(state) {
  switch (state) {
    case SLA_STATE.BREACHED:
      return 0;
    case SLA_STATE.ESCALATED:
      return 1;
    case SLA_STATE.WARNING:
      return 2;
    case SLA_STATE.PAUSED:
      return 3;
    case SLA_STATE.ON_TRACK:
      return 4;
    case SLA_STATE.AWAITING_ASSIGNMENT:
      return 5;
    case SLA_STATE.MET:
      return 6;
    default:
      return 7;
  }
}

/**
 * Initialize server-owned SLA fields on a new/reopened assignment document (mutates).
 */
function applySlaOnAssign(doc, { orderType = "STANDARD_11E", at = null } = {}) {
  const t = at || now();
  const slaDurationMs = getSlaMsForOrderType(orderType);
  if (!doc.assignedAt) doc.assignedAt = t;
  doc.slaDurationMs = slaDurationMs;
  doc.slaPausedTotalMs = 0;
  doc.slaPausedAt = null;
  doc.slaExtensions = Array.isArray(doc.slaExtensions) ? doc.slaExtensions : [];
  const dueAt = computeDueAt({
    assignedAt: doc.assignedAt,
    slaDurationMs,
    pausedTotalMs: 0,
    slaPausedAt: null,
    extensions: doc.slaExtensions,
    at: t,
  });
  doc.dueAt = dueAt;
  doc.dueDate = dueAt; // legacy mirror
  doc.slaState = SLA_STATE.ON_TRACK;
  return doc;
}

function pauseSla(doc, { at = null } = {}) {
  const t = at || now();
  if (doc.slaPausedAt) return doc;
  doc.slaPausedAt = t;
  doc.slaState = SLA_STATE.PAUSED;
  return doc;
}

function resumeSla(doc, { at = null } = {}) {
  const t = at || now();
  if (doc.slaPausedAt) {
    const pStart = new Date(doc.slaPausedAt).getTime();
    if (Number.isFinite(pStart)) {
      doc.slaPausedTotalMs = (Number(doc.slaPausedTotalMs) || 0) + Math.max(0, t.getTime() - pStart);
    }
    doc.slaPausedAt = null;
  }
  doc.dueAt = computeDueAt({
    assignedAt: doc.assignedAt,
    slaDurationMs: doc.slaDurationMs || getStandardSlaMs(),
    pausedTotalMs: doc.slaPausedTotalMs || 0,
    slaPausedAt: null,
    extensions: doc.slaExtensions,
    at: t,
  });
  doc.dueDate = doc.dueAt;
  const snap = resolveSlaState(doc, { at: t });
  doc.slaState = snap.state;
  return doc;
}

/**
 * Immutable SLA extension. Returns extension entry.
 */
function extendSla(doc, { ms, reason, by, at = null }) {
  const t = at || now();
  const amount = Math.round(Number(ms));
  if (!Number.isFinite(amount) || amount <= 0) {
    const { BadRequestError } = require("../utils/errors");
    throw new BadRequestError("Extension ms must be a positive number", {
      code: "INVALID_SLA_EXTENSION",
    });
  }
  const entry = {
    at: t,
    ms: amount,
    reason: String(reason || "admin_extension").slice(0, 500),
    by: by || null,
  };
  if (!Array.isArray(doc.slaExtensions)) doc.slaExtensions = [];
  doc.slaExtensions.push(entry);
  // Extensions are immutable history — recompute dueAt from fields
  if (doc.slaPausedAt) {
    // keep paused; dueAt still slides with pause
    doc.dueAt = computeDueAt({
      assignedAt: doc.assignedAt,
      slaDurationMs: doc.slaDurationMs || getStandardSlaMs(),
      pausedTotalMs: doc.slaPausedTotalMs || 0,
      slaPausedAt: doc.slaPausedAt,
      extensions: doc.slaExtensions,
      at: t,
    });
  } else {
    doc.dueAt = computeDueAt({
      assignedAt: doc.assignedAt,
      slaDurationMs: doc.slaDurationMs || getStandardSlaMs(),
      pausedTotalMs: doc.slaPausedTotalMs || 0,
      slaPausedAt: null,
      extensions: doc.slaExtensions,
      at: t,
    });
  }
  doc.dueDate = doc.dueAt;
  const snap = resolveSlaState(doc, { at: t });
  doc.slaState = snap.state;
  return entry;
}

function decorateAssignment(assignment, opts = {}) {
  if (!assignment) return assignment;
  const sla = buildSlaSnapshot(assignment, opts);
  return { ...assignment, sla, dueAt: sla.dueAt, dueDate: sla.dueDate };
}

function decorateAssignmentList(list, opts = {}) {
  return (list || []).map((a) => decorateAssignment(a, opts));
}

function sortBySlaRisk(list) {
  return [...(list || [])].sort((a, b) => {
    const ra = a.sla?.riskRank ?? slaRiskRank(a.slaState) ?? 99;
    const rb = b.sla?.riskRank ?? slaRiskRank(b.slaState) ?? 99;
    if (ra !== rb) return ra - rb;
    const da = a.sla?.dueAt || a.dueAt || "";
    const db = b.sla?.dueAt || b.dueAt || "";
    return String(da).localeCompare(String(db));
  });
}

module.exports = {
  SLA_STATE,
  DISPLAY_TIMEZONE,
  setNowProvider,
  resetNowProvider,
  now,
  getStandardSlaMs,
  getExpressSlaMs,
  getWarningMs,
  getEscalateMs,
  getSlaMsForOrderType,
  getPolicy,
  computeDueAt,
  resolveSlaState,
  buildSlaSnapshot,
  slaRiskRank,
  applySlaOnAssign,
  pauseSla,
  resumeSla,
  extendSla,
  decorateAssignment,
  decorateAssignmentList,
  sortBySlaRisk,
  sumExtensionsMs,
};
