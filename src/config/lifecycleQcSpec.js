/**
 * M-08 — Canonical lifecycle + QC specification (single signed source of truth).
 *
 * Product owner + engineering approve this module. FE labels, notifications,
 * analytics keys, SOPs, and marketing copy MUST derive from here — not from
 * handoff decks, PRD drafts, or live-site variants.
 *
 * Spec id: NORTHCOT-LIFECYCLE-QC-M08
 */

const {
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
} = require("./constants");
const { BadRequestError } = require("../utils/errors");

const LIFECYCLE_QC_SPEC = Object.freeze({
  specId: "NORTHCOT-LIFECYCLE-QC-M08",
  version: "2026.07.25",
  reviewDate: "2026-07-25",
  approvedBy: "Product Owner + Engineering",
  signatureStatus: "APPROVED_IN_REPO",
  notes:
    "Supersedes conflicting handoff (8 states / 6-point QC), PRD aliases, and site 3/6-point or Express-bypass-QC claims.",
});

/** Product / order types covered by this matrix. */
const ORDER_TYPES = Object.freeze({
  STANDARD_11E: "STANDARD_11E",
  EXPRESS_11E: "EXPRESS_11E",
});

/**
 * Approved QC checklist for 11E (10 checks).
 * Express does NOT shorten or bypass this list.
 */
const QC_CHECKLIST_11E = Object.freeze([
  { id: 1, code: "IDENTITY", label: "Survey number / village identity matches application" },
  { id: 2, code: "BOUNDARY", label: "Boundary geometry complete and closed where required" },
  { id: 3, code: "SCALE", label: "Scale / units consistent with drawing standards" },
  { id: 4, code: "NORTH", label: "North direction indicated" },
  { id: 5, code: "LABELS", label: "Adjacent features / labels legible" },
  { id: 6, code: "APPLICANT", label: "Owner / applicant details consistent with order" },
  { id: 7, code: "FORMAT", label: "File format and layers usable by CAD workflow" },
  { id: 8, code: "TOPOLOGY", label: "No critical overlaps or self-intersections" },
  { id: 9, code: "REVISION", label: "Revision history / version noted if rework" },
  { id: 10, code: "RELEASE", label: "Final deliverable reviewed before surveyor release" },
]);

const QC_MATRIX = Object.freeze({
  checklistId: "11E-QC-10",
  version: LIFECYCLE_QC_SPEC.version,
  product: "11E",
  checkCount: QC_CHECKLIST_11E.length,
  checks: QC_CHECKLIST_11E,
  byOrderType: Object.freeze({
    [ORDER_TYPES.STANDARD_11E]: Object.freeze({
      requiresQc: true,
      checklistId: "11E-QC-10",
      checkCount: 10,
      expressBypassQc: false,
    }),
    [ORDER_TYPES.EXPRESS_11E]: Object.freeze({
      requiresQc: true,
      checklistId: "11E-QC-10",
      checkCount: 10,
      /** Explicit: Express is faster SLA only — never skips QC. */
      expressBypassQc: false,
      slaNote: "Express shortens delivery SLA target; QC matrix is identical to STANDARD_11E.",
    }),
  }),
  siteCopyApproved: Object.freeze([
    "Every drawing is QC-checked against the approved 11E 10-point checklist before release.",
  ]),
  prohibitedCopy: Object.freeze([
    "3-point QC",
    "6-point QC",
    "six-point QC",
    "100% QC",
    "government approved QC",
    "Express bypasses QC",
    "Express skips quality check",
    "no QC for Express",
  ]),
});

/**
 * Canonical sketch upload statuses (API enums).
 * Labels are the only FE-facing names for dashboards / customer copy.
 */
const SKETCH_STATUS_CATALOG = Object.freeze([
  {
    code: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
    value: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
    label: "Awaiting booking payment",
    analyticsKey: "sketch_payment_pending",
    terminal: false,
    notificationTrigger: "SKETCH_PAYMENT_PENDING",
  },
  {
    code: SURVEY_SKETCH_STATUS.PENDING,
    value: SURVEY_SKETCH_STATUS.PENDING,
    label: "Queued for CAD assignment",
    analyticsKey: "sketch_pending_assignment",
    terminal: false,
    notificationTrigger: "SKETCH_QUEUED",
  },
  {
    code: SURVEY_SKETCH_STATUS.ASSIGNED,
    value: SURVEY_SKETCH_STATUS.ASSIGNED,
    label: "Assigned to CAD",
    analyticsKey: "sketch_assigned",
    terminal: false,
    notificationTrigger: "SKETCH_ASSIGNED",
  },
  {
    code: SURVEY_SKETCH_STATUS.CAD_DELIVERED,
    value: SURVEY_SKETCH_STATUS.CAD_DELIVERED,
    label: "CAD delivered (balance may be required)",
    analyticsKey: "sketch_cad_delivered",
    terminal: false,
    notificationTrigger: "SKETCH_CAD_DELIVERED",
  },
  {
    code: SURVEY_SKETCH_STATUS.UNDER_REVISION,
    value: SURVEY_SKETCH_STATUS.UNDER_REVISION,
    label: "Under revision",
    analyticsKey: "sketch_under_revision",
    terminal: false,
    notificationTrigger: "SKETCH_UNDER_REVISION",
  },
  {
    code: SURVEY_SKETCH_STATUS.APPROVED,
    value: SURVEY_SKETCH_STATUS.APPROVED,
    label: "Completed",
    analyticsKey: "sketch_approved",
    terminal: true,
    notificationTrigger: "SKETCH_APPROVED",
  },
  {
    code: SURVEY_SKETCH_STATUS.REJECTED,
    value: SURVEY_SKETCH_STATUS.REJECTED,
    label: "Cancelled / rejected",
    analyticsKey: "sketch_rejected",
    terminal: true,
    notificationTrigger: "SKETCH_REJECTED",
  },
]);

const ASSIGNMENT_STATUS_CATALOG = Object.freeze([
  {
    code: SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    label: "Assigned (awaiting CAD accept)",
    analyticsKey: "assignment_assigned",
  },
  {
    code: SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    label: "In progress",
    analyticsKey: "assignment_in_progress",
  },
  {
    code: SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
    label: "On hold",
    analyticsKey: "assignment_on_hold",
  },
  {
    code: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    label: "Completed delivery",
    analyticsKey: "assignment_completed",
  },
  {
    code: SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
    label: "Cancelled",
    analyticsKey: "assignment_cancelled",
  },
]);

/**
 * Allowed sketch status transitions (from → to[]).
 * Same-status is always allowed (idempotent).
 */
const SKETCH_TRANSITIONS = Object.freeze({
  [SURVEY_SKETCH_STATUS.PAYMENT_PENDING]: Object.freeze([
    SURVEY_SKETCH_STATUS.PENDING,
    SURVEY_SKETCH_STATUS.REJECTED,
  ]),
  [SURVEY_SKETCH_STATUS.PENDING]: Object.freeze([
    SURVEY_SKETCH_STATUS.ASSIGNED,
    SURVEY_SKETCH_STATUS.REJECTED,
    SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
  ]),
  [SURVEY_SKETCH_STATUS.ASSIGNED]: Object.freeze([
    SURVEY_SKETCH_STATUS.CAD_DELIVERED,
    SURVEY_SKETCH_STATUS.PENDING,
    SURVEY_SKETCH_STATUS.REJECTED,
  ]),
  [SURVEY_SKETCH_STATUS.CAD_DELIVERED]: Object.freeze([
    SURVEY_SKETCH_STATUS.UNDER_REVISION,
    SURVEY_SKETCH_STATUS.APPROVED,
    SURVEY_SKETCH_STATUS.REJECTED,
  ]),
  [SURVEY_SKETCH_STATUS.UNDER_REVISION]: Object.freeze([
    SURVEY_SKETCH_STATUS.ASSIGNED,
    SURVEY_SKETCH_STATUS.CAD_DELIVERED,
    SURVEY_SKETCH_STATUS.PENDING,
    SURVEY_SKETCH_STATUS.REJECTED,
  ]),
  [SURVEY_SKETCH_STATUS.APPROVED]: Object.freeze([]),
  [SURVEY_SKETCH_STATUS.REJECTED]: Object.freeze([]),
});

const ASSIGNMENT_TRANSITIONS = Object.freeze({
  [SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED]: Object.freeze([
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
  ]),
  [SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS]: Object.freeze([
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
  ]),
  [SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD]: Object.freeze([
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED,
  ]),
  [SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED]: Object.freeze([
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
    SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS,
  ]),
  [SURVEY_SKETCH_ASSIGNMENT_STATUS.CANCELLED]: Object.freeze([
    SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED,
  ]),
});

const ALLOWED_INITIAL_SKETCH_STATUSES = Object.freeze([
  SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
  SURVEY_SKETCH_STATUS.PENDING,
]);

/**
 * Legacy / PRD / handoff synonyms → canonical API code.
 * Reporting and migrations must normalize through this map.
 */
const LEGACY_SKETCH_STATUS_MAP = Object.freeze({
  UNDER_REVIEW: SURVEY_SKETCH_STATUS.UNDER_REVISION,
  IN_REVIEW: SURVEY_SKETCH_STATUS.UNDER_REVISION,
  REVIEW: SURVEY_SKETCH_STATUS.UNDER_REVISION,
  QUEUED: SURVEY_SKETCH_STATUS.PENDING,
  SUBMITTED: SURVEY_SKETCH_STATUS.PENDING,
  UPLOADED: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
  DRAFT: SURVEY_SKETCH_STATUS.PAYMENT_PENDING,
  PAID: SURVEY_SKETCH_STATUS.PENDING,
  IN_PROGRESS: SURVEY_SKETCH_STATUS.ASSIGNED,
  WORKING: SURVEY_SKETCH_STATUS.ASSIGNED,
  DELIVERED: SURVEY_SKETCH_STATUS.CAD_DELIVERED,
  READY: SURVEY_SKETCH_STATUS.CAD_DELIVERED,
  COMPLETED: SURVEY_SKETCH_STATUS.APPROVED,
  CLOSED: SURVEY_SKETCH_STATUS.APPROVED,
  DONE: SURVEY_SKETCH_STATUS.APPROVED,
  CANCELLED: SURVEY_SKETCH_STATUS.REJECTED,
  CANCELED: SURVEY_SKETCH_STATUS.REJECTED,
  FAILED: SURVEY_SKETCH_STATUS.REJECTED,
});

/** Marketing milestone path (H-08) — derived from canonical states, not a second machine. */
const ORDER_LIFECYCLE_MILESTONES = Object.freeze([
  "SURVEYOR_UPLOAD",
  "BOOKING_PAYMENT",
  "ASSIGNED_TO_CAD",
  "QC_11E_10_POINT",
  "CAD_DELIVERED",
  "BALANCE_PAYMENT_FIXED_400",
  "SURVEYOR_DOWNLOAD",
  "OPTIONAL_REVISION",
]);

function normalizeSketchStatus(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s) return null;
  const upper = s.toUpperCase();
  if (upper === "UNDER_REVIEW") return SURVEY_SKETCH_STATUS.UNDER_REVISION;
  if (LEGACY_SKETCH_STATUS_MAP[upper]) return LEGACY_SKETCH_STATUS_MAP[upper];
  const known = new Set(SKETCH_STATUS_CATALOG.map((c) => c.code));
  if (known.has(upper)) return upper;
  return upper;
}

function normalizeAssignmentStatus(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim().toUpperCase();
  return s;
}

function assertSketchStatusTransition(fromRaw, toRaw) {
  const to = normalizeSketchStatus(toRaw);
  const from = normalizeSketchStatus(fromRaw);
  const known = new Set(SKETCH_STATUS_CATALOG.map((c) => c.code));

  if (!known.has(to)) {
    throw new BadRequestError(`Unknown sketch status: ${toRaw}`, {
      code: "INVALID_SKETCH_STATUS",
    });
  }

  if (from === to) return { from, to, noop: true };

  if (from == null) {
    if (!ALLOWED_INITIAL_SKETCH_STATUSES.includes(to)) {
      throw new BadRequestError(`Invalid initial sketch status: ${to}`, {
        code: "INVALID_SKETCH_TRANSITION",
        errors: [{ from: null, to }],
      });
    }
    return { from: null, to, noop: false };
  }

  if (!known.has(from)) {
    throw new BadRequestError(`Unknown sketch status (from): ${fromRaw}`, {
      code: "INVALID_SKETCH_STATUS",
    });
  }

  const allowed = SKETCH_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new BadRequestError(`Invalid sketch status transition: ${from} → ${to}`, {
      code: "INVALID_SKETCH_TRANSITION",
      errors: [{ from, to, allowed: [...allowed] }],
    });
  }
  return { from, to, noop: false };
}

function assertAssignmentStatusTransition(fromRaw, toRaw) {
  const to = normalizeAssignmentStatus(toRaw);
  const from = normalizeAssignmentStatus(fromRaw);
  const known = new Set(Object.values(SURVEY_SKETCH_ASSIGNMENT_STATUS));
  if (!known.has(to)) {
    throw new BadRequestError(`Unknown assignment status: ${toRaw}`, {
      code: "INVALID_ASSIGNMENT_STATUS",
    });
  }
  if (from === to) return { from, to, noop: true };
  if (from == null) {
    if (to !== SURVEY_SKETCH_ASSIGNMENT_STATUS.ASSIGNED) {
      throw new BadRequestError(`Invalid initial assignment status: ${to}`, {
        code: "INVALID_ASSIGNMENT_TRANSITION",
      });
    }
    return { from: null, to, noop: false };
  }
  const allowed = ASSIGNMENT_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new BadRequestError(`Invalid assignment status transition: ${from} → ${to}`, {
      code: "INVALID_ASSIGNMENT_TRANSITION",
      errors: [{ from, to, allowed: [...allowed] }],
    });
  }
  return { from, to, noop: false };
}

/**
 * Apply a sketch status change with M-08 transition enforcement.
 * Mutates `doc.status` to the canonical code.
 */
function applySketchStatus(doc, nextStatus) {
  const result = assertSketchStatusTransition(doc?.status, nextStatus);
  if (doc && typeof doc === "object") {
    doc.status = result.to;
  }
  return result;
}

function applyAssignmentStatus(doc, nextStatus) {
  const result = assertAssignmentStatusTransition(doc?.status, nextStatus);
  if (doc && typeof doc === "object") {
    doc.status = result.to;
  }
  return result;
}

function requiresQcForOrderType(orderType = ORDER_TYPES.STANDARD_11E) {
  const row = QC_MATRIX.byOrderType[orderType] || QC_MATRIX.byOrderType[ORDER_TYPES.STANDARD_11E];
  return Boolean(row.requiresQc) && row.expressBypassQc !== true;
}

function assertQcRequiredForRelease(orderType = ORDER_TYPES.STANDARD_11E) {
  if (!requiresQcForOrderType(orderType)) {
    throw new BadRequestError("QC bypass is not allowed for any order type", {
      code: "QC_BYPASS_FORBIDDEN",
    });
  }
  return {
    orderType,
    checklistId: QC_MATRIX.checklistId,
    checkCount: QC_MATRIX.checkCount,
    expressBypassQc: false,
  };
}

function getSketchStatusEnums() {
  return SKETCH_STATUS_CATALOG.map((c) => c.code);
}

function getSketchStatusLabels() {
  const out = {};
  for (const c of SKETCH_STATUS_CATALOG) out[c.code] = c.label;
  return out;
}

function getNotificationTriggers() {
  return SKETCH_STATUS_CATALOG.map((c) => ({
    status: c.code,
    trigger: c.notificationTrigger,
  }));
}

function getAnalyticsKeys() {
  return SKETCH_STATUS_CATALOG.map((c) => ({
    status: c.code,
    analyticsKey: c.analyticsKey,
  }));
}

/**
 * Public / FE payload — same source as SOPs and marketing.
 */
function getLifecycleQcPublicSpec() {
  return {
    ...LIFECYCLE_QC_SPEC,
    orderTypes: ORDER_TYPES,
    qc: {
      checklistId: QC_MATRIX.checklistId,
      version: QC_MATRIX.version,
      product: QC_MATRIX.product,
      checkCount: QC_MATRIX.checkCount,
      checks: QC_MATRIX.checks,
      byOrderType: QC_MATRIX.byOrderType,
      siteCopyApproved: QC_MATRIX.siteCopyApproved,
      prohibitedCopy: QC_MATRIX.prohibitedCopy,
    },
    sketchStatuses: SKETCH_STATUS_CATALOG,
    assignmentStatuses: ASSIGNMENT_STATUS_CATALOG,
    sketchTransitions: SKETCH_TRANSITIONS,
    assignmentTransitions: ASSIGNMENT_TRANSITIONS,
    legacySketchStatusMap: LEGACY_SKETCH_STATUS_MAP,
    orderLifecycleMilestones: ORDER_LIFECYCLE_MILESTONES,
    labels: getSketchStatusLabels(),
    notificationTriggers: getNotificationTriggers(),
    analyticsKeys: getAnalyticsKeys(),
  };
}

/** Assert constants enums stay aligned with this catalog. */
function assertLifecycleCatalogAligned() {
  const catalogCodes = SKETCH_STATUS_CATALOG.map((c) => c.code);
  const unique = new Set(catalogCodes);
  if (unique.size !== catalogCodes.length) {
    throw new Error("Duplicate sketch status in catalog");
  }
  for (const code of catalogCodes) {
    if (!Object.values(SURVEY_SKETCH_STATUS).includes(code)) {
      throw new Error(`Catalog status missing from SURVEY_SKETCH_STATUS: ${code}`);
    }
  }
  if (QC_CHECKLIST_11E.length !== 10) {
    throw new Error("11E QC must have exactly 10 checks");
  }
  if (QC_MATRIX.byOrderType[ORDER_TYPES.EXPRESS_11E].expressBypassQc !== false) {
    throw new Error("Express must not bypass QC");
  }
}

assertLifecycleCatalogAligned();

module.exports = {
  LIFECYCLE_QC_SPEC,
  ORDER_TYPES,
  QC_CHECKLIST_11E,
  QC_MATRIX,
  SKETCH_STATUS_CATALOG,
  ASSIGNMENT_STATUS_CATALOG,
  SKETCH_TRANSITIONS,
  ASSIGNMENT_TRANSITIONS,
  LEGACY_SKETCH_STATUS_MAP,
  ORDER_LIFECYCLE_MILESTONES,
  normalizeSketchStatus,
  normalizeAssignmentStatus,
  assertSketchStatusTransition,
  assertAssignmentStatusTransition,
  applySketchStatus,
  applyAssignmentStatus,
  requiresQcForOrderType,
  assertQcRequiredForRelease,
  getSketchStatusEnums,
  getSketchStatusLabels,
  getNotificationTriggers,
  getAnalyticsKeys,
  getLifecycleQcPublicSpec,
  assertLifecycleCatalogAligned,
};
