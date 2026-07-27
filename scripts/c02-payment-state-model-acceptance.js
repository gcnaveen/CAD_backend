/**
 * Audit §4.1 payment state model checks (points 25–28 unit-level).
 * Run: node scripts/c02-payment-state-model-acceptance.js
 */

const {
  sanitizeProviderReference,
  PAYMENT_PURPOSE,
  PROVIDER_STATE,
} = require("../src/services/paymentAttempt.service");
const { assertPaidMatchesExpected } = require("../src/services/phonePeSketchPayment.service");

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

// 25 — expected amount is server-side concept (assert helper never takes client amount as expected source)
assert(
  "paid must match expected ₹400",
  assertPaidMatchesExpected(40000, { amount: 40000 }).ok === true
);
assert(
  "client-like ₹1 does not match expected",
  assertPaidMatchesExpected(40000, { amount: 100 }).ok === false
);

// 26 — sanitize strips secrets
const dirty = {
  state: "COMPLETED",
  amount: 40000,
  transactionId: "txn_1",
  clientSecret: "SECRET",
  accessToken: "tok",
  authorization: "Bearer x",
};
const clean = sanitizeProviderReference(dirty, "balabc");
assert("sanitize keeps state", clean.state === "COMPLETED");
assert("sanitize keeps amount", clean.amountPaise === 40000);
assert("sanitize keeps txn", clean.transactionId === "txn_1");
assert("sanitize drops clientSecret", clean.clientSecret === undefined);
assert("sanitize drops accessToken", clean.accessToken === undefined);
assert("sanitize drops authorization", clean.authorization === undefined);

assert("purpose constants exist", PAYMENT_PURPOSE.BOOKING && PAYMENT_PURPOSE.BALANCE && PAYMENT_PURPOSE.REVISION);
assert("provider states include COMPLETED", PROVIDER_STATE.COMPLETED === "COMPLETED");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
