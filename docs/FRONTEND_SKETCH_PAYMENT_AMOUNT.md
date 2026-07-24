# Frontend Guide: Sketch Payment Amount (PhonePe)

PhonePe checkout must charge the **amount the frontend sends**, not a hardcoded ₹10 (or any fixed value in code).

---

## Base API URL

| Environment | Base URL |
|-------------|----------|
| Dev (current) | `https://m8earcixrb.execute-api.ap-south-1.amazonaws.com` |

---

## How amount is chosen (priority)

| Priority | Source | When |
|----------|--------|------|
| **1** | Frontend body: `amount` / `amountRupees` / `amountPaise` | **Always preferred** when sent |
| 2 | Admin pricing (`PATCH /api/admin/survey-sketch-pricing`) | If no frontend amount |
| 3 | Env `SKETCH_UPLOAD_FEE_PAISE` / `SKETCH_REVISION_FEE_PAISE` | If no admin plan |

There is **no hardcoded ₹10** in the backend. If PhonePe shows ₹10, either:

- frontend sent `amount: 10`, or
- admin pricing in DB is set to ₹10, or
- an old pending payment was stored as ₹10

**Fix:** always send the display amount from the UI with the payment request.

---

## 1) Sketch upload (create)

**`POST /api/surveyor/sketch-uploads`**

Send the amount the user sees on screen (₹). Prefer `amount` or `amountRupees`.

```json
{
  "surveyType": "single_flat",
  "district": "...",
  "taluka": "...",
  "surveyNo": "123",
  "singleUpload": [{ "url": "https://..." }],
  "amount": 500
}
```

| Field | Example | Meaning |
|-------|---------|---------|
| `amount` | `500` | ₹500 (recommended for forms) |
| `amountRupees` | `500` | ₹500 |
| `amountPaise` | `50000` | 50000 paise = ₹500 |

**Send only one** of these fields.

### Response check

```json
{
  "success": true,
  "meta": {
    "payment": {
      "requiresPayment": true,
      "checkoutPageUrl": "https://...",
      "amountPaise": 50000,
      "payableRupees": 500,
      "pricingSource": "client"
    }
  }
}
```

Confirm `meta.payment.payableRupees` matches what the UI showed before redirecting to PhonePe.

`pricingSource`:

| Value | Meaning |
|-------|---------|
| `client` | Amount came from your request body |
| `admin` | Admin pricing used (no amount in body) |
| `env` | Env fee used |

---

## 2) Retry payment

**`POST /api/surveyor/sketch-uploads/{uploadId}/retry-payment`**

Optional body — send amount again if the user can change price, or to fix a wrong stored ₹10:

```json
{
  "amount": 500
}
```

If body has no amount, backend reuses the **stored** `sketchPayment.amountPaise` from create.

---

## 3) Paid revision (#2+)

**`POST /api/surveyor/sketch-uploads/{uploadId}/revision-request`**

```json
{
  "remarks": "Please adjust boundary",
  "amount": 200
}
```

Same amount fields as upload. Used for PhonePe when revision #2+ requires payment.

---

## Recommended frontend flow

1. Call `GET /api/surveyor/sketch-pricing` (or your own pricing UI) to show the fee.
2. On submit, **send that same fee** as `amount` (₹) in the create / revision / retry body.
3. Before open PhonePe, assert `meta.payment.payableRupees === shownAmount`.
4. If mismatch, do not redirect — show error.

```javascript
async function createSketchWithPayment(payload, amountRupees) {
  const res = await fetch(`${API_BASE}/api/surveyor/sketch-uploads`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, amount: Number(amountRupees) }),
  });
  const json = await res.json();
  const payable = json?.meta?.payment?.payableRupees;
  if (json?.meta?.payment?.requiresPayment) {
    if (Number(payable) !== Number(amountRupees)) {
      throw new Error(`Amount mismatch: UI ${amountRupees} vs gateway ${payable}`);
    }
    window.location.href = json.meta.payment.checkoutPageUrl;
  }
  return json;
}
```

---

## Common mistake (₹10 bug)

| Wrong | Right |
|-------|--------|
| Don’t send amount → admin DB plan ₹10 is charged | Send `"amount": 500` from UI |
| Send `"amountPaise": 10` thinking ₹10 | That is **₹0.10** — use `"amount": 10` for ₹10, or `"amountPaise": 1000` |
| Hardcode `10` in frontend | Use value from pricing API / calculated fee |

---

## Deploy

```bash
cd CAD_backend && npm run deploy:dev:insecure
```
