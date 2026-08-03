/**
 * CAD-02 exclusive workflow phase + CAD-03 dashboard count semantics.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  WORKFLOW_PHASE,
  resolveWorkflowPhase,
  withWorkflowPhase,
} = require("../../src/utils/workflowPhase");
const { SURVEY_SKETCH_STATUS, SURVEY_SKETCH_ASSIGNMENT_STATUS } = require("../../src/config/constants");
const { getApprovedBusinessRulesPublic } = require("../../src/config/businessRulesBaseline");

describe("CAD-02 workflowPhase exclusivity", () => {
  it("PAYMENT_PENDING is upload-only (not completed/revision)", () => {
    const wf = resolveWorkflowPhase({ status: SURVEY_SKETCH_STATUS.PAYMENT_PENDING }, null);
    assert.equal(wf.workflowPhase, WORKFLOW_PHASE.AWAITING_PAYMENT);
    assert.equal(wf.primaryMode, "upload");
    assert.equal(wf.exclusiveModes.upload, true);
    assert.equal(wf.exclusiveModes.revision, false);
    assert.equal(wf.exclusiveModes.completed, false);
  });

  it("UNDER_REVISION is revision-only even if cadDeliverable exists on upload", () => {
    const wf = resolveWorkflowPhase(
      {
        status: SURVEY_SKETCH_STATUS.UNDER_REVISION,
        cadDeliverable: [{ fileName: "x.dwg" }],
      },
      { status: SURVEY_SKETCH_ASSIGNMENT_STATUS.COMPLETED }
    );
    assert.equal(wf.workflowPhase, WORKFLOW_PHASE.UNDER_REVISION);
    assert.equal(wf.primaryMode, "revision");
    assert.equal(wf.exclusiveModes.revision, true);
    assert.equal(wf.exclusiveModes.completed, false);
    assert.equal(wf.exclusiveModes.upload, false);
  });

  it("APPROVED is completed-only", () => {
    const wf = resolveWorkflowPhase({ status: SURVEY_SKETCH_STATUS.APPROVED }, null);
    assert.equal(wf.primaryMode, "completed");
    assert.deepEqual(wf.exclusiveModes, {
      upload: false,
      revision: false,
      completed: true,
    });
  });

  it("withWorkflowPhase attaches fields", () => {
    const row = withWorkflowPhase({ status: SURVEY_SKETCH_STATUS.PENDING, _id: "1" }, null);
    assert.equal(row.workflowPhase, WORKFLOW_PHASE.UPLOAD_QUEUED);
    assert.equal(row.primaryMode, "upload");
  });
});

describe("SUPPORT-01 supportContact on business rules", () => {
  it("exposes supportContact object", () => {
    const prev = {
      SUPPORT_WHATSAPP_URL: process.env.SUPPORT_WHATSAPP_URL,
      SUPPORT_WHATSAPP_NUMBER: process.env.SUPPORT_WHATSAPP_NUMBER,
      SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
    };
    process.env.SUPPORT_WHATSAPP_NUMBER = "+91 98765 43210";
    process.env.SUPPORT_EMAIL = "help@north-cot.com";
    delete process.env.SUPPORT_WHATSAPP_URL;
    try {
      const r = getApprovedBusinessRulesPublic();
      assert.ok(r.supportContact);
      assert.equal(r.supportContact.whatsappUrl, "https://wa.me/919876543210");
      assert.equal(r.supportContact.email, "help@north-cot.com");
      assert.equal(r.supportContact.configured, true);
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
