# Frontend Guide: CAD User Dashboard & Wallet

APIs for the **logged-in CAD user** home dashboard: wallet cards and order count cards.

---

## Base API URL

| Environment | Base URL |
|-------------|----------|
| Dev (current) | `https://m8earcixrb.execute-api.ap-south-1.amazonaws.com` |

---

## Auth (all endpoints)

- **Header:** `Authorization: Bearer <CAD user JWT>`
- **Role:** `CAD` only

---

## Quick start — one API for the whole dashboard

Use this on the CAD home screen to load **wallet + order counts** in a single request.

### `GET /api/cad/dashboard/overview`

```http
GET /api/cad/dashboard/overview
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Example response (200)

```json
{
  "success": true,
  "data": {
    "wallet": {
      "totalEarningsPaise": 25000,
      "receivedPaymentPaise": 10000,
      "pendingPaymentPaise": 15000,
      "totalEarningsRupees": 250,
      "receivedPaymentRupees": 100,
      "pendingPaymentRupees": 150,
      "totalEarnings": 250,
      "receivedPayment": 100,
      "pendingPayment": 150,
      "receivedPayments": 100,
      "pendingPayments": 150
    },
    "orders": {
      "totalOrders": 12,
      "acceptedOrders": 8,
      "rejectedOrders": 1,
      "inProgressOrders": 3
    }
  }
}
```

### Dashboard UI mapping

| Card | Field |
|------|-------|
| **Total Earnings (₹)** | `data.wallet.totalEarnings` |
| **Received Payments (₹)** | `data.wallet.receivedPayments` or `data.wallet.receivedPayment` |
| **Pending Payments (₹)** | `data.wallet.pendingPayments` or `data.wallet.pendingPayment` |
| **Total Orders** | `data.orders.totalOrders` |
| **Accepted Orders** | `data.orders.acceptedOrders` |
| **Rejected Orders** | `data.orders.rejectedOrders` |
| **In-Progress Orders** | `data.orders.inProgressOrders` |

```javascript
async function loadCadDashboard(token) {
  const res = await fetch(`${API_BASE}/api/cad/dashboard/overview`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { data } = await res.json();
  return {
    wallet: {
      totalEarnings: data.wallet.totalEarnings,
      receivedPayments: data.wallet.receivedPayments,
      pendingPayments: data.wallet.pendingPayments,
    },
    orders: {
      totalOrders: data.orders.totalOrders,
      acceptedOrders: data.orders.acceptedOrders,
      rejectedOrders: data.orders.rejectedOrders,
      inProgressOrders: data.orders.inProgressOrders,
    },
  };
}
```

---

## Separate APIs (if you prefer two calls)

### 1) Wallet summary

**`GET /api/cad/wallet`**

Returns earnings after completed sketch deliveries.

| Metric | Field (₹) | Field (paise) |
|--------|-----------|---------------|
| Total Earnings | `data.totalEarnings` | `data.totalEarningsPaise` |
| Received Payments | `data.receivedPayments` or `data.receivedPayment` | `data.receivedPaymentPaise` |
| Pending Payments | `data.pendingPayments` or `data.pendingPayment` | `data.pendingPaymentPaise` |

```http
GET /api/cad/wallet
Authorization: Bearer <CAD JWT>
```

```json
{
  "success": true,
  "data": {
    "totalEarningsPaise": 25000,
    "receivedPaymentPaise": 10000,
    "pendingPaymentPaise": 15000,
    "totalEarnings": 250,
    "receivedPayments": 100,
    "pendingPayments": 150
  }
}
```

**When amounts appear**

| Event | Wallet updates? |
|-------|-----------------|
| Admin assigns sketch | No |
| CAD delivers sketch | **Yes** — `totalEarnings` and `pendingPayments` increase |
| Admin pays CAD | **Yes** — `receivedPayments` up, `pendingPayments` down |

Earning formula: **surveyor paid amount × 20%** (`CAD_PAYOUT_PERCENT` on server).

---

### 2) Order summary counts

**`GET /api/cad/dashboard/stats`**

Alias: **`GET /api/cad/dashboard`** (same response).

```http
GET /api/cad/dashboard/stats
Authorization: Bearer <CAD JWT>
```

```json
{
  "success": true,
  "data": {
    "totalOrders": 12,
    "acceptedOrders": 8,
    "rejectedOrders": 1,
    "inProgressOrders": 3
  }
}
```

| Count | Meaning |
|-------|---------|
| `totalOrders` | Assignments linked to you **or** jobs you rejected |
| `acceptedOrders` | You accepted and worked on (IN_PROGRESS, ON_HOLD, or COMPLETED) |
| `rejectedOrders` | You rejected (CANCELLED + `rejectedByCad`) |
| `inProgressOrders` | Currently active (IN_PROGRESS or ON_HOLD) |

---

### 3) Wallet transaction history (optional detail screen)

**`GET /api/cad/wallet/transactions?page=1&limit=20`**

Paginated list of each earning row (per delivery) with paid % and remaining balance.

```json
{
  "success": true,
  "data": [
    {
      "_id": "...",
      "kind": "INITIAL_DELIVERY",
      "amountRupees": 100,
      "paidAmountRupees": 50,
      "remainingRupees": 50,
      "paidPercent": 50,
      "balanceStatus": "PARTIAL",
      "surveyorSketchUpload": {
        "applicationId": "KA-BLR/BLR-N/26/5",
        "surveyNo": "123/4"
      }
    }
  ],
  "meta": {
    "pagination": { "page": 1, "limit": 20, "total": 5, "totalPages": 1 }
  }
}
```

---

## Related APIs

| Action | API |
|--------|-----|
| List my assignments | `GET /api/cad/assignments` |
| Accept assignment | `POST /api/cad/assignments/{assignmentId}/accept` |
| Reject assignment | `POST /api/cad/assignments/{assignmentId}/reject` |
| Deliver sketch | `POST /api/cad/assignments/{assignmentId}/deliver` |

---

## Errors

| HTTP | When |
|------|------|
| `401` | Missing or invalid token |
| `403` | User is not role `CAD` |

---

## Recommended dashboard layout

```
┌─────────────────┬─────────────────┬─────────────────┐
│ Total Earnings  │ Received Pay.   │ Pending Pay.    │
│ ₹250            │ ₹100            │ ₹150            │
└─────────────────┴─────────────────┴─────────────────┘

┌──────────┬──────────┬──────────┬──────────────┐
│ Total    │ Accepted │ Rejected │ In-Progress  │
│ 12       │ 8        │ 1        │ 3            │
└──────────┴──────────┴──────────┴──────────────┘
```

Load with: **`GET /api/cad/dashboard/overview`** (one call).

---

## Deploy

Backend changes require deploy:

```bash
cd CAD_backend && npm run deploy:dev:insecure
```
