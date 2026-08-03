/**
 * BIZ-10: server-side booking payment gate for sketch workflow mutations.
 *
 * Unpaid bookings (PAYMENT_PENDING, or amountPaise > 0 without COMPLETED) must not
 * be assigned, delivered, or otherwise progressed by Admin/CAD/jobs.
 * Fee-zero uploads (no amount / amountPaise ≤ 0) are allowed through.
 */

const { BadRequestError } = require("../utils/errors");
const { SURVEY_SKETCH_STATUS } = require("../config/constants");

function bookingAmountPaise(upload) {
  const n = Number(upload?.sketchPayment?.amountPaise);
  return Number.isFinite(n) ? n : 0;
}

/** True when booking fee is waived or PhonePe booking is COMPLETED. */
function isSketchBookingPaymentSatisfied(upload) {
  const amount = bookingAmountPaise(upload);
  if (amount <= 0) return true;
  return String(upload?.sketchPayment?.status || "") === "COMPLETED";
}

/**
 * Block assignment / workflow progression until booking payment is satisfied.
 * @param {object} upload SurveyorSketchUpload doc or lean
 * @param {{ action?: string }} [opts]
 */
function assertSketchBookingPaymentAllowsWorkflow(upload, opts = {}) {
  const action = opts.action || "workflow";

  if (!upload) {
    throw new BadRequestError("Survey sketch upload is required for payment gate", {
      code: "SKETCH_PAYMENT_GATE_NO_UPLOAD",
    });
  }

  if (upload.status === SURVEY_SKETCH_STATUS.PAYMENT_PENDING) {
    throw new BadRequestError("Survey sketch payment is not completed yet.", {
      code: "SKETCH_PAYMENT_PENDING",
      errors: [{ action, status: upload.status }],
    });
  }

  if (!isSketchBookingPaymentSatisfied(upload)) {
    throw new BadRequestError("Survey sketch booking payment is incomplete.", {
      code: "SKETCH_PAYMENT_INCOMPLETE",
      errors: [
        {
          action,
          paymentStatus: upload?.sketchPayment?.status || null,
          amountPaise: bookingAmountPaise(upload),
        },
      ],
    });
  }

  return true;
}

module.exports = {
  bookingAmountPaise,
  isSketchBookingPaymentSatisfied,
  assertSketchBookingPaymentAllowsWorkflow,
};
