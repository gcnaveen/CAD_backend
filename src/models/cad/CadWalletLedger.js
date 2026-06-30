/**
 * CAD user earnings from completed sketch assignments. Amounts in paise.
 * Entries start PENDING; admin marks PAID when payout is sent.
 */

const mongoose = require("mongoose");
const { CAD_WALLET_ENTRY_STATUS, CAD_WALLET_ENTRY_KIND } = require("../../config/constants");

const CadWalletLedgerSchema = new mongoose.Schema(
  {
    cadUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    assignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveySketchAssignment",
      default: null,
      index: true,
    },
    surveyorSketchUpload: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SurveyorSketchUpload",
      default: null,
      index: true,
    },
    kind: {
      type: String,
      enum: Object.values(CAD_WALLET_ENTRY_KIND),
      required: true,
    },
    /** 0 = initial delivery; >=1 = revision delivery sequence. */
    revisionNo: {
      type: Number,
      default: null,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    /** Surveyor amount paid for this delivery (upload or revision fee), in paise. */
    sourcePaidAmountPaise: {
      type: Number,
      default: null,
      min: 0,
    },
    /** Payout percent used when crediting this row (e.g. 20 = 20%). */
    payoutPercent: {
      type: Number,
      default: null,
      min: 0,
    },
    /** Cumulative amount marked paid by admin (paise). Remaining = amountPaise − paidAmountPaise until fully settled. */
    paidAmountPaise: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** Audit trail for each admin payment tranche (partial or full). */
    paymentLog: {
      type: [
        {
          amountPaise: { type: Number, required: true, min: 1 },
          recordedAt: { type: Date, default: () => new Date() },
          recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
        },
      ],
      default: [],
    },
    status: {
      type: String,
      enum: Object.values(CAD_WALLET_ENTRY_STATUS),
      default: CAD_WALLET_ENTRY_STATUS.PENDING,
      index: true,
    },
    paidAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, strict: true }
);

CadWalletLedgerSchema.index({ cadUser: 1, createdAt: -1 });
CadWalletLedgerSchema.index({ assignment: 1, kind: 1, revisionNo: 1 }, { unique: true });

module.exports =
  mongoose.models.CadWalletLedger || mongoose.model("CadWalletLedger", CadWalletLedgerSchema);
