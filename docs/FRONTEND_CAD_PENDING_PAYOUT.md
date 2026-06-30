# Frontend Guide: CAD Payout & Pending Balance (Admin)

Admin APIs to see **how much each CAD user has earned** from completed assignments, **how much is already paid**, and **how much is still pending** — then record a new payout.

---

## Base API URL

| Environment | Base URL |
|-------------|----------|
| Dev (current) | `https://m8earcixrb.execute-api.ap-south-1.amazonaws.com` |

---

## How CAD earning is calculated

| Rule | Detail |
|------|--------|
| Formula | **CAD earning = surveyor paid amount × payout %** |
| Default % | **20%** (`CAD_PAYOUT_PERCENT` on server) |
| Example | Survey paid **₹500** → CAD earns **₹100** |
| Example | Survey paid **₹1000** → CAD earns **₹200** |
| Initial delivery | Uses `sketchPayment.paidAmountPaise` on the upload |
| Revision delivery | Uses paid revision fee for that `revisionNo` (`revisionFeePayments`) |
| Free revision (#1) | No surveyor payment → **₹0** CAD earning for that revision |

Ledger rows are created when CAD **completes** an assignment delivery. The pending-summary API also **syncs** missing rows from completed assignments.

---

## 1) Get statistics — all CAD users

**`GET /api/admin/cad-wallet/pending-summary`**

- **Auth:** `Authorization: Bearer <admin or super-admin JWT>`
- **Roles:** `ADMIN`, `SUPER_ADMIN`

```http
GET /api/admin/cad-wallet/pending-summary
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Example response (200)

```json
{
  "success": true,
  "data": {
    "payoutPercent": 20,
    "totalPendingPaise": 30000,
    "totalPendingRupees": 300,
    "totalPending": 300,
    "statistics": {
      "payoutPercent": 20,
      "cadUserCount": 5,
      "assignmentCount": 8,
      "completedDeliveryCount": 10,
      "totalSourcePaidPaise": 250000,
      "totalSourcePaidRupees": 2500,
      "totalSourcePaid": 2500,
      "totalEarningsPaise": 50000,
      "totalEarningsRupees": 500,
      "totalEarnings": 500,
      "receivedPaymentPaise": 20000,
      "receivedPaymentRupees": 200,
      "receivedPayment": 200,
      "pendingPaymentPaise": 30000,
      "pendingPaymentRupees": 300,
      "pendingPayment": 300
    },
    "cadUsers": [
      {
        "cadUser": {
          "_id": "507f1f77bcf86cd799439011",
          "name": { "first": "Ravi", "last": "Kumar" },
          "role": "CAD",
          "auth": { "email": "ravi@example.com" }
        },
        "summary": {
          "totalEarnings": 250,
          "receivedPayment": 100,
          "pendingPayment": 150
        },
        "statistics": {
          "payoutPercent": 20,
          "assignmentCount": 2,
          "completedDeliveryCount": 3,
          "totalSourcePaid": 1250,
          "totalEarnings": 250,
          "receivedPayment": 100,
          "pendingPayment": 150
        },
        "pendingEntryCount": 2
      }
    ]
  }
}
```

### UI mapping (list screen)

| UI label | Field |
|----------|-------|
| Platform pending (₹) | `data.totalPending` |
| Platform total earned (₹) | `data.statistics.totalEarnings` |
| Platform already paid (₹) | `data.statistics.receivedPayment` |
| Payout % | `data.payoutPercent` |
| CAD name | `data.cadUsers[].cadUser.name` |
| Per-user pending (₹) | `data.cadUsers[].summary.pendingPayment` |
| Per-user earned (₹) | `data.cadUsers[].summary.totalEarnings` |
| Per-user paid (₹) | `data.cadUsers[].summary.receivedPayment` |

---

## 2) Get statistics — one CAD user (detail + assignments)

**`GET /api/admin/cad-wallet/pending-summary?cadUserId={id}`**

Use on the **CAD payout detail** screen before recording payment.

```http
GET /api/admin/cad-wallet/pending-summary?cadUserId=507f1f77bcf86cd799439011
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Example response (200)

```json
{
  "success": true,
  "data": {
    "cadUser": {
      "_id": "507f1f77bcf86cd799439011",
      "name": { "first": "Ravi", "last": "Kumar" },
      "role": "CAD",
      "auth": { "email": "ravi@example.com" }
    },
    "summary": {
      "totalEarningsPaise": 25000,
      "pendingPaymentPaise": 15000,
      "receivedPaymentPaise": 10000,
      "totalEarnings": 250,
      "pendingPayment": 150,
      "receivedPayment": 100
    },
    "statistics": {
      "payoutPercent": 20,
      "assignmentCount": 2,
      "completedDeliveryCount": 3,
      "totalSourcePaidPaise": 125000,
      "totalSourcePaid": 1250,
      "totalEarnings": 250,
      "receivedPayment": 100,
      "pendingPayment": 150
    },
    "pendingEntryCount": 2,
    "assignments": [
      {
        "assignmentId": "65abc123...",
        "applicationId": "KA-BLR/BLR-N/26/5",
        "surveyNo": "123/4",
        "status": "COMPLETED",
        "completedAt": "2026-06-01T10:30:00.000Z",
        "assignmentEarnedPaise": 10000,
        "assignmentEarnedRupees": 100,
        "assignmentPaidPaise": 5000,
        "assignmentPaidRupees": 50,
        "assignmentRemainingPaise": 5000,
        "assignmentRemainingRupees": 50,
        "entries": [
          {
            "ledgerId": "65def456...",
            "kind": "INITIAL_DELIVERY",
            "revisionNo": 0,
            "sourcePaidAmountPaise": 50000,
            "sourcePaidRupees": 500,
            "payoutPercent": 20,
            "amountPaise": 10000,
            "amountRupees": 100,
            "paidAmountPaise": 5000,
            "paidAmountRupees": 50,
            "remainingPaise": 5000,
            "remainingRupees": 50,
            "paidPercent": 50,
            "balanceStatus": "PARTIAL"
          }
        ]
      }
    ]
  }
}
```

### UI mapping (detail screen)

| UI label | Field |
|----------|-------|
| **Pending to pay (₹)** | `data.summary.pendingPayment` |
| Already paid (₹) | `data.summary.receivedPayment` |
| Total earned (₹) | `data.summary.totalEarnings` |
| Surveyor payments total (₹) | `data.statistics.totalSourcePaid` |
| Assignment list | `data.assignments[]` |
| Survey ID | `data.assignments[].applicationId` |
| Per assignment pending (₹) | `data.assignments[].assignmentRemainingRupees` |
| Survey paid for delivery (₹) | `data.assignments[].entries[].sourcePaidRupees` |
| CAD earning for delivery (₹) | `data.assignments[].entries[].amountRupees` |
| Delivery paid % | `data.assignments[].entries[].paidPercent` |

```javascript
function cadPayoutDetail(data) {
  return {
    pendingRupees: data.summary.pendingPayment,
    earnedRupees: data.summary.totalEarnings,
    paidRupees: data.summary.receivedPayment,
    payoutPercent: data.statistics.payoutPercent,
    assignments: data.assignments.map((a) => ({
      applicationId: a.applicationId,
      earned: a.assignmentEarnedRupees,
      paid: a.assignmentPaidRupees,
      remaining: a.assignmentRemainingRupees,
      deliveries: a.entries.map((e) => ({
        kind: e.kind,
        revisionNo: e.revisionNo,
        surveyPaid: e.sourcePaidRupees,
        cadEarned: e.amountRupees,
        cadPaid: e.paidAmountRupees,
        cadRemaining: e.remainingRupees,
        paidPercent: e.paidPercent,
      })),
    })),
  };
}
```

---

## 3) Record payment to CAD user (admin)

**`POST /api/admin/cad-wallet/pay-user`**

Admin **enters how much** they paid the CAD user (partial or full). Server applies it to **oldest pending** ledger entries first.

### Pay form (frontend)

Use `GET .../pending-summary?cadUserId=...` → `data.payment` for the modal:

| UI field | API source |
|----------|------------|
| Pending owed (₹) | `data.summary.pendingPayment` |
| Max you can pay (₹) | `data.payment.maxPayable` |
| Amount input `max` | `data.payment.maxPayable` |
| Show “Pay full” button | `data.payment.canPayFull === true` |

```javascript
// Open pay modal
const { summary, payment, cadUser } = payoutDetail.data;

// User-entered amount (₹) — partial or full
async function payCadUser(cadUserId, amountRupees) {
  return fetch("/api/admin/cad-wallet/pay-user", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cadUserId, amount: Number(amountRupees) }),
  });
}

// Or pay entire pending without typing amount
async function payCadUserFull(cadUserId) {
  return fetch("/api/admin/cad-wallet/pay-user", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cadUserId, payFull: true }),
  });
}
```

### Option A — Custom amount (recommended for pay form)

```http
POST /api/admin/cad-wallet/pay-user
Authorization: Bearer <admin JWT>
Content-Type: application/json

{
  "cadUserId": "507f1f77bcf86cd799439011",
  "amount": 150
}
```

Accepted amount fields (**send only one**):

| Field | Example | Meaning |
|-------|---------|---------|
| `amount` | `150` | ₹150 (best for input fields) |
| `amountRupees` | `150` | ₹150 |
| `amountPaise` | `15000` | 15000 paise = ₹150 |

### Option B — Pay full pending balance

```json
{
  "cadUserId": "507f1f77bcf86cd799439011",
  "payFull": true
}
```

Do **not** send `amount` / `amountRupees` / `amountPaise` together with `payFull: true`.

### Example response (200)

```json
{
  "success": true,
  "data": {
    "cadUserId": "507f1f77bcf86cd799439011",
    "requestedAmountPaise": 15000,
    "requestedAmountRupees": 150,
    "appliedAmountPaise": 15000,
    "appliedAmountRupees": 150,
    "unappliedAmountPaise": 0,
    "unappliedAmountRupees": 0,
    "touchedEntryIds": ["65def456..."],
    "summary": {
      "totalEarnings": 250,
      "receivedPayment": 250,
      "pendingPayment": 0
    }
  }
}
```

### Frontend flow

1. Open detail → `GET .../pending-summary?cadUserId=...`
2. Show `summary.pendingPayment` as max payable hint
3. Admin enters amount → `POST .../pay-user`
4. Refresh detail → pending should decrease; `receivedPayment` increases

| Field after pay | Meaning |
|-----------------|---------|
| `appliedAmountRupees` | Amount actually applied to ledger |
| `unappliedAmountRupees` | Over-payment not used (if admin paid more than pending) |
| `summary.pendingPayment` | New remaining balance |

---

## Optional: pay one ledger row (partial / full)

| API | Use |
|-----|-----|
| `POST /api/admin/cad-wallet-entries/{entryId}/record-payment` | Pay partial or full on one delivery row |
| `POST /api/admin/cad-wallet-entries/{entryId}/mark-paid` | Mark one row fully paid |

Body for record-payment:

```json
{ "amountRupees": 50 }
```

or `{ "payFull": true }`

---

## CAD user self-service (reference)

| API | Who |
|-----|-----|
| `GET /api/cad/wallet` | CAD user — own totals |
| `GET /api/cad/wallet/transactions` | CAD user — delivery-wise history |

---

## Errors

| HTTP | When |
|------|------|
| `400` | Invalid `cadUserId` or invalid pay body |
| `401` | Missing or invalid token |
| `403` | Not admin / super admin |
| `404` | `cadUserId` is not an active CAD user |

---

## Notes

- All amounts are stored in **paise** on the server; **rupee** fields are provided for display.
- **Pending** = total CAD earnings − admin payments already recorded (supports partial payouts per delivery).
- Users with **no completed assignments** appear in the list with all amounts **0**.
- After deploy, call pending-summary once to **backfill** ledger rows for old completed assignments.
