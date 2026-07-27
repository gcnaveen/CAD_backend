/**
 * Audit C-02 acceptance checks for download entitlement (no DB / PhonePe).
 * Run: node scripts/c02-download-entitlement-acceptance.js
 */

const {
  isDownloadEntitled,
  isRefunded,
  BALANCE_PAYMENT_STATUSES,
} = require("../src/services/cadDownloadEntitlement.service");
const {
  parseBalanceUploadIdFromMerchantOrder,
  assertPaidMatchesExpected,
} = require("../src/services/phonePeSketchPayment.service");

let passed = 0;
let failed = 0;

function assert(name, cond) {
  if (cond) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${name}`);
  }
}

// unpaid / required
assert(
  "unpaid not entitled",
  !isDownloadEntitled({
    balancePayment: { status: "REQUIRED", amountPaise: 40000, paidAmountPaise: null },
    downloadEntitlement: { granted: false },
  })
);

// Tampered granted flag alone must NEVER unlock
assert(
  "granted flag alone does not unlock",
  !isDownloadEntitled({
    balancePayment: { status: "REQUIRED", amountPaise: 40000, paidAmountPaise: null },
    downloadEntitlement: { granted: true, reason: "BALANCE_PAID" },
  })
);

// amount not locked
assert(
  "unlocked amount not entitled",
  !isDownloadEntitled({
    balancePayment: { status: "NONE", amountPaise: null },
    downloadEntitlement: { granted: true },
  })
);

// ₹1 mismatch
assert(
  "₹1 paid not entitled",
  !isDownloadEntitled({
    balancePayment: {
      status: "AMOUNT_MISMATCH",
      amountPaise: 40000,
      paidAmountPaise: 100,
    },
    downloadEntitlement: { granted: false },
  })
);

assert(
  "assertPaidMatchesExpected rejects ₹1",
  assertPaidMatchesExpected(40000, { amount: 100 }).ok === false
);

// pending
assert(
  "pending not entitled",
  !isDownloadEntitled({
    balancePayment: { status: "PENDING", amountPaise: 40000 },
    downloadEntitlement: { granted: false },
  })
);

// failed
assert(
  "failed not entitled",
  !isDownloadEntitled({
    balancePayment: { status: "FAILED", amountPaise: 40000 },
    downloadEntitlement: { granted: false },
  })
);

// refunded
assert(
  "refunded blocked even if completed amounts match",
  !isDownloadEntitled({
    balancePayment: {
      status: "REFUNDED",
      amountPaise: 40000,
      paidAmountPaise: 40000,
      refundedAt: new Date(),
    },
    downloadEntitlement: { granted: true, reason: "BALANCE_PAID" },
  })
);
assert(
  "isRefunded true",
  isRefunded({ balancePayment: { status: "REFUNDED", refundedAt: new Date() } })
);

// mismatched completed without equal paid
assert(
  "completed with wrong paidAmount not entitled via paid check",
  !isDownloadEntitled({
    balancePayment: {
      status: "COMPLETED",
      amountPaise: 40000,
      paidAmountPaise: 100,
    },
    downloadEntitlement: { granted: false },
  })
);

// reconciled ₹400 unlocks
assert(
  "reconciled ₹400 entitled via status+amounts",
  isDownloadEntitled({
    balancePayment: {
      status: BALANCE_PAYMENT_STATUSES.COMPLETED,
      amountPaise: 40000,
      paidAmountPaise: 40000,
    },
    downloadEntitlement: { granted: false },
  })
);

assert(
  "FEE_WAIVED amount 0 entitled without granted flag",
  isDownloadEntitled({
    balancePayment: { status: "NONE", amountPaise: 0 },
    downloadEntitlement: { granted: false },
  })
);

assert(
  "assertPaidMatchesExpected accepts ₹400",
  assertPaidMatchesExpected(40000, { amount: 40000 }).ok === true
);

// merchant order parse
assert(
  "parse balance merchant order id",
  parseBalanceUploadIdFromMerchantOrder("bal507f1f77bcf86cd799439011rabc123") ===
    "507f1f77bcf86cd799439011"
);

assert(
  "sketch id not parsed as balance",
  parseBalanceUploadIdFromMerchantOrder("sk507f1f77bcf86cd799439011rabc123") === null
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
