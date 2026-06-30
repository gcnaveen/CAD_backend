/**
 * CAD payout = percentage of surveyor payment received for that assignment delivery.
 * Example at 20%: survey paid ₹500 → CAD earns ₹100; survey paid ₹1000 → CAD earns ₹200.
 *
 * Env: CAD_PAYOUT_PERCENT (default 20)
 */

function getCadPayoutPercent() {
  const raw = process.env.CAD_PAYOUT_PERCENT;
  if (raw === undefined || raw === null || String(raw).trim() === "") return 20;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) && n >= 0 ? n : 20;
}

function computeCadPayoutPaiseFromSourcePaid(sourcePaidPaise) {
  const paid = Math.max(0, Math.round(Number(sourcePaidPaise) || 0));
  if (paid <= 0) return 0;
  const percent = getCadPayoutPercent();
  return Math.round((paid * percent) / 100);
}

function resolveInitialDeliverySourcePaidPaise(upload) {
  if (!upload) return 0;
  const sp = upload.sketchPayment || {};
  if (sp.paidAmountPaise != null && Number(sp.paidAmountPaise) > 0) {
    return Math.round(Number(sp.paidAmountPaise));
  }
  if (sp.status === "COMPLETED" && sp.amountPaise != null && Number(sp.amountPaise) > 0) {
    return Math.round(Number(sp.amountPaise));
  }
  return 0;
}

function resolveRevisionSourcePaidPaise(upload, revisionNo) {
  if (!upload || revisionNo == null) return 0;
  const rev = Number(revisionNo);
  if (!Number.isFinite(rev)) return 0;
  const payments = Array.isArray(upload.revisionFeePayments) ? upload.revisionFeePayments : [];
  const match = payments.find((p) => Number(p.revisionNo) === rev);
  if (!match) return 0;
  if (match.paidAmountPaise != null && Number(match.paidAmountPaise) > 0) {
    return Math.round(Number(match.paidAmountPaise));
  }
  if (match.chargedAmountPaise != null && Number(match.chargedAmountPaise) > 0) {
    return Math.round(Number(match.chargedAmountPaise));
  }
  return 0;
}

function resolveSourcePaidPaiseForLedgerKind(upload, kind, revisionNo) {
  const { CAD_WALLET_ENTRY_KIND } = require("../config/constants");
  if (kind === CAD_WALLET_ENTRY_KIND.INITIAL_DELIVERY) {
    return resolveInitialDeliverySourcePaidPaise(upload);
  }
  if (kind === CAD_WALLET_ENTRY_KIND.REVISION_DELIVERY) {
    return resolveRevisionSourcePaidPaise(upload, revisionNo);
  }
  return 0;
}

module.exports = {
  getCadPayoutPercent,
  computeCadPayoutPaiseFromSourcePaid,
  resolveInitialDeliverySourcePaidPaise,
  resolveRevisionSourcePaidPaise,
  resolveSourcePaidPaiseForLedgerKind,
};
