# Frontend Guide: Super Admin Dashboard Statistics

Single API for the Super Admin / Admin home dashboard cards and charts.

---

## Base API URL

| Environment | Base URL |
|-------------|----------|
| Dev (current) | `https://m8earcixrb.execute-api.ap-south-1.amazonaws.com` |

---

## API

**`GET /api/admin/dashboard/stats`**

- **Auth:** `Authorization: Bearer <admin or super-admin JWT>`
- **Roles:** `SUPER_ADMIN`, `ADMIN`

### Example request

```http
GET /api/admin/dashboard/stats
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Example response (200)

```json
{
  "success": true,
  "data": {
    "users": {
      "totalUsers": 120,
      "superAdminUsers": 1,
      "adminUsers": 5,
      "cadUsers": 20,
      "surveyorUsers": 94
    },
    "drafts": {
      "totalDrafts": 32
    },
    "orders": {
      "totalOrders": 85,
      "byStatus": {
        "PAYMENT_PENDING": 3,
        "PENDING": 10,
        "ASSIGNED": 15,
        "CAD_DELIVERED": 20,
        "UNDER_REVISION": 5,
        "APPROVED": 30,
        "REJECTED": 2,
        "total": 85
      }
    },
    "payments": {
      "totalReceived": {
        "amountPaise": 2500000,
        "amountRupees": 25000,
        "sketchUploadPayments": 45,
        "revisionPayments": 5
      },
      "pending": {
        "count": 4,
        "amountPaise": 200000,
        "amountRupees": 2000,
        "sketchUploadPending": 3,
        "revisionPaymentPending": 1
      },
      "failed": {
        "count": 2,
        "sketchUploadFailed": 1,
        "revisionPaymentFailed": 1
      }
    }
  }
}
```

---

## Dashboard mapping

### Users section

| UI label | Response field |
|----------|----------------|
| Total Users | `data.users.totalUsers` |
| Super Admin | `data.users.superAdminUsers` |
| Admin Users | `data.users.adminUsers` |
| CAD Users | `data.users.cadUsers` |
| Surveyor / End Users | `data.users.surveyorUsers` |

### Drafts

| UI label | Response field |
|----------|----------------|
| Total Drafts | `data.drafts.totalDrafts` |

(Non-deleted survey drafts only.)

### Orders by status

| UI label | Response field |
|----------|----------------|
| Total Orders | `data.orders.totalOrders` |
| Per status count | `data.orders.byStatus.<STATUS>` |

**Status keys** (survey sketch upload workflow):

| Status | Meaning |
|--------|---------|
| `PAYMENT_PENDING` | Awaiting PhonePe payment |
| `PENDING` | Paid / free — awaiting admin assignment |
| `ASSIGNED` | Assigned to CAD |
| `CAD_DELIVERED` | CAD delivered sketch |
| `UNDER_REVISION` | Revision in progress |
| `APPROVED` | Completed / approved |
| `REJECTED` | Rejected / cancelled |

Use `byStatus.total` or `totalOrders` (same value).

### Payments

| UI label | Response field |
|----------|----------------|
| Total received (₹) | `data.payments.totalReceived.amountRupees` |
| Total received (paise) | `data.payments.totalReceived.amountPaise` |
| Pending payments (count) | `data.payments.pending.count` |
| Pending amount (₹) | `data.payments.pending.amountRupees` |
| Failed payments (count) | `data.payments.failed.count` |

**Payment definitions:**

- **Total received** — completed sketch upload payments + completed revision payments (PhonePe)
- **Pending** — uploads in `PAYMENT_PENDING` (unpaid) + revision checkout not completed
- **Failed** — sketch `sketchPayment.status === FAILED` + revision `pendingRevisionPayment.status === FAILED`

---

## Example: React fetch

```javascript
const API_BASE = "https://m8earcixrb.execute-api.ap-south-1.amazonaws.com";

export async function fetchAdminDashboardStats(token) {
  const res = await fetch(`${API_BASE}/api/admin/dashboard/stats`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Failed to load dashboard");
  return json.data;
}
```

### Display amounts

```javascript
function formatRupees(rupees) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees);
}

// formatRupees(data.payments.totalReceived.amountRupees)
```

---

## Suggested dashboard layout

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Total Users │ Admin Users │  CAD Users  │  Surveyors  │
│     120     │      5      │     20      │     94      │
└─────────────┴─────────────┴─────────────┴─────────────┘

┌─────────────┬─────────────────────────────────────────┐
│ Total Drafts│  Orders by status (bar chart / pills)   │
│     32      │  PENDING: 10  ASSIGNED: 15  ...         │
└─────────────┴─────────────────────────────────────────┘

┌──────────────────┬──────────────────┬──────────────────┐
│ Total Received   │ Pending Payment  │ Failed Payment   │
│    ₹25,000       │   4 (₹2,000)     │       2          │
└──────────────────┴──────────────────┴──────────────────┘
```

---

## Errors

| HTTP | Meaning |
|------|---------|
| 401 | Missing or invalid token |
| 403 | Not Admin / Super Admin |

---

## Notes

- Call on dashboard mount; refresh on interval or pull-to-refresh if needed.
- Amounts are in **Indian Rupees** (`amountRupees`) and **paise** (`amountPaise`) for precision.
- Login: `POST /api/auth/login` with admin email + password.
