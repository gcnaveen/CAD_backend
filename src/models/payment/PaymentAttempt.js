/**
 * Immutable payment attempt ledger (audit §4.1 / points 25–29).
 * Browser never creates or mutates expected amounts / order identity here.
 */

const mongoose = require("mongoose");

const PAYMENT_PURPOSE = Object.freeze({
  BOOKING: "BOOKING",
  BALANCE: "BALANCE",
  REVISION: "REVISION",
});

const PROVIDER_STATE = Object.freeze({
  PENDING: "PENDING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  AMOUNT_MISMATCH: "AMOUNT_MISMATCH",
  EXPIRED: "EXPIRED",
  REFUNDED: "REFUNDED",
});

const RECON_FLAG = Object.freeze({
  MISSING: "MISSING",
  DUPLICATED: "DUPLICATED",
  MISMATCHED: "MISMATCHED",
  EXPIRED: "EXPIRED",
  REFUNDED: "REFUNDED",
  MANUALLY_ADJUSTED: "MANUALLY_ADJUSTED",
});

const PaymentAttemptSchema = new mongoose.Schema(
  {
    purpose: {
      type: String,
      enum: Object.values(PAYMENT_PURPOSE),
      required: true,
      index: true,
    },
    provider: {
      type: String,
      default: "PHONEPE",
      immutable: true,
    },
    /** Locked order identity — callback cannot change this. */
    surveyorSketchUpload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveyorSketchUpload",
      required: true,
      index: true,
      immutable: true,
    },
    surveyor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    revisionNo: {
      type: Number,
      default: null,
    },
    /** Immutable merchant transaction / order id for this attempt. */
    merchantOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    /** Immutable expected amount (paise) — never overridden by callback. */
    expectedAmountPaise: {
      type: Number,
      required: true,
      min: 1,
      immutable: true,
    },
    providerState: {
      type: String,
      enum: Object.values(PROVIDER_STATE),
      default: PROVIDER_STATE.PENDING,
      index: true,
    },
    paidAmountPaise: {
      type: Number,
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
    initiatedAt: {
      type: Date,
      default: () => new Date(),
      immutable: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    lastProviderCheckAt: {
      type: Date,
      default: null,
    },
    /**
     * Sanitized provider reference only (state, ids, amount) — never raw secrets / credentials.
     */
    providerReference: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    reconciliationFlags: {
      type: [
        {
          flag: { type: String, enum: Object.values(RECON_FLAG), required: true },
          at: { type: Date, default: () => new Date() },
          note: { type: String, default: null, maxlength: 500 },
        },
      ],
      default: () => [],
    },
    manuallyAdjusted: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
    strict: true,
    collection: "payment_attempts",
  }
);

PaymentAttemptSchema.index({ surveyorSketchUpload: 1, purpose: 1, createdAt: -1 });
PaymentAttemptSchema.index({ providerState: 1, initiatedAt: 1 });
PaymentAttemptSchema.index({ "reconciliationFlags.flag": 1, updatedAt: -1 });

module.exports =
  mongoose.models.PaymentAttempt || mongoose.model("PaymentAttempt", PaymentAttemptSchema);

module.exports.PAYMENT_PURPOSE = PAYMENT_PURPOSE;
module.exports.PROVIDER_STATE = PROVIDER_STATE;
module.exports.RECON_FLAG = RECON_FLAG;
