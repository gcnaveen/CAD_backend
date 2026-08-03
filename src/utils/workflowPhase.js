/**
 * CAD-02: exclusive workflow phase for FE — Completed / Revision / Upload never coexist.
 * Prefer `workflowPhase` over inferring from leftover cadDeliverable + stale assignment rows.
 */

const {
  SURVEY_SKETCH_STATUS,
  SURVEY_SKETCH_ASSIGNMENT_STATUS,
} = require("../config/constants");

/** Exclusive UI modes — exactly one applies per sketch at a time. */
const WORKFLOW_PHASE = Object.freeze({
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  UPLOAD_QUEUED: "UPLOAD_QUEUED",
  ASSIGNED_PENDING_ACCEPT: "ASSIGNED_PENDING_ACCEPT",
  IN_PROGRESS: "IN_PROGRESS",
  DELIVERED: "DELIVERED",
  UNDER_REVISION: "UNDER_REVISION",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  UNKNOWN: "UNKNOWN",
});

/**
 * Resolve a single exclusive phase from sketch status + display assignment.
 * Sketch status is authoritative; assignment refines ASSIGNED/IN_PROGRESS only.
 *
 * @param {object|null} upload lean upload
 * @param {object|null} assignment display assignment (non-cancelled preferred)
 * @returns {{
 *   workflowPhase: string,
 *   exclusiveModes: { upload: boolean, revision: boolean, completed: boolean },
 *   sketchStatus: string|null,
 *   assignmentStatus: string|null,
 * }}
 */
function resolveWorkflowPhase(upload, assignment = null) {
  const sketchStatus = upload?.status ? String(upload.status) : null;
  const assignmentStatus = assignment?.status ? String(assignment.status) : null;

  let workflowPhase = WORKFLOW_PHASE.UNKNOWN;

  switch (sketchStatus) {
    case SURVEY_SKETCH_STATUS.PAYMENT_PENDING:
      workflowPhase = WORKFLOW_PHASE.AWAITING_PAYMENT;
      break;
    case SURVEY_SKETCH_STATUS.PENDING:
      workflowPhase = WORKFLOW_PHASE.UPLOAD_QUEUED;
      break;
    case SURVEY_SKETCH_STATUS.UNDER_REVISION:
      workflowPhase = WORKFLOW_PHASE.UNDER_REVISION;
      break;
    case SURVEY_SKETCH_STATUS.CAD_DELIVERED:
      workflowPhase = WORKFLOW_PHASE.DELIVERED;
      break;
    case SURVEY_SKETCH_STATUS.APPROVED:
      workflowPhase = WORKFLOW_PHASE.COMPLETED;
      break;
    case SURVEY_SKETCH_STATUS.REJECTED:
      workflowPhase = WORKFLOW_PHASE.CANCELLED;
      break;
    case SURVEY_SKETCH_STATUS.ASSIGNED:
      if (assignmentStatus === SURVEY_SKETCH_ASSIGNMENT_STATUS.IN_PROGRESS) {
        workflowPhase = WORKFLOW_PHASE.IN_PROGRESS;
      } else if (assignmentStatus === SURVEY_SKETCH_ASSIGNMENT_STATUS.ON_HOLD) {
        workflowPhase = WORKFLOW_PHASE.IN_PROGRESS;
      } else if (assignmentStatus === SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED) {
        // Stale assignment COMPLETED while sketch still ASSIGNED → treat as in progress / assigned
        workflowPhase = WORKFLOW_PHASE.ASSIGNED_PENDING_ACCEPT;
      } else {
        workflowPhase = WORKFLOW_PHASE.ASSIGNED_PENDING_ACCEPT;
      }
      break;
    default:
      workflowPhase = WORKFLOW_PHASE.UNKNOWN;
  }

  const exclusiveModes = {
    upload:
      workflowPhase === WORKFLOW_PHASE.AWAITING_PAYMENT ||
      workflowPhase === WORKFLOW_PHASE.UPLOAD_QUEUED ||
      workflowPhase === WORKFLOW_PHASE.ASSIGNED_PENDING_ACCEPT ||
      workflowPhase === WORKFLOW_PHASE.IN_PROGRESS,
    revision: workflowPhase === WORKFLOW_PHASE.UNDER_REVISION,
    completed: workflowPhase === WORKFLOW_PHASE.COMPLETED || workflowPhase === WORKFLOW_PHASE.DELIVERED,
  };

  // Hard exclusivity: at most one of upload/revision/completed primary modes for UI tabs.
  const primary =
    exclusiveModes.revision
      ? "revision"
      : exclusiveModes.completed
        ? "completed"
        : exclusiveModes.upload
          ? "upload"
          : "none";

  return {
    workflowPhase,
    primaryMode: primary,
    exclusiveModes: {
      upload: primary === "upload",
      revision: primary === "revision",
      completed: primary === "completed",
    },
    sketchStatus,
    assignmentStatus,
  };
}

/** Attach workflow fields onto a presented upload row. */
function withWorkflowPhase(upload, assignment = null) {
  if (!upload || typeof upload !== "object") return upload;
  const wf = resolveWorkflowPhase(upload, assignment);
  return {
    ...upload,
    workflowPhase: wf.workflowPhase,
    primaryMode: wf.primaryMode,
    exclusiveModes: wf.exclusiveModes,
  };
}

module.exports = {
  WORKFLOW_PHASE,
  resolveWorkflowPhase,
  withWorkflowPhase,
};
