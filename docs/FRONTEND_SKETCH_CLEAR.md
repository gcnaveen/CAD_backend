# Frontend Guide: Clear (Delete) Unpaid Survey Upload

Use this when the surveyor wants to **discard** a sketch submission that **was not paid** and start over.

---

## Base API URL

| Environment | Base URL |
|-------------|----------|
| Dev (current) | `https://m8earcixrb.execute-api.ap-south-1.amazonaws.com` |

---

## When to show the **Clear** button

Show **Clear** next to **Retry payment** on the same unpaid upload:

| Field | Condition |
|-------|-----------|
| `data.status` | `PAYMENT_PENDING` |
| `data.sketchPayment.status` | `FAILED`, `PENDING`, or `NONE` (not `COMPLETED`) |

```javascript
function canClearSketchUpload(upload) {
  return (
    upload?.status === "PAYMENT_PENDING" &&
    upload?.sketchPayment?.status !== "COMPLETED"
  );
}
```

**Do not** show Clear when:

- Payment succeeded (`sketchPayment.status === "COMPLETED"`)
- Upload is in workflow (`status` is `PENDING`, `ASSIGNED`, `CAD_DELIVERED`, etc.)

---

## Clear API

**`POST /api/surveyor/sketch-uploads/{uploadId}/clear`**

- **Auth:** `Authorization: Bearer <surveyor JWT>`
- **Body:** none (empty POST is fine)

### Example

```http
POST /api/surveyor/sketch-uploads/6a3c3b54c42704183ef90135/clear
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

### Success (200)

```json
{
  "success": true,
  "data": {
    "uploadId": "6a3c3b54c42704183ef90135",
    "applicationId": "KA-BLR/BLR-N/26/5",
    "message": "Survey upload removed"
  }
}
```

### What happens

- The survey upload is **permanently deleted** from the database
- Linked assignment rows (if any) are removed
- **Cannot be undone** — surveyor must submit a new upload from scratch

### Frontend after success

1. Remove the item from the local list / orders screen
2. Navigate back to “New survey” or home
3. Optionally show toast: “Survey cleared”

---

## UI flow (with Retry)

```mermaid
sequenceDiagram
  participant App as Frontend
  participant API as Backend

  App->>App: User on unpaid upload (PAYMENT_PENDING)

  alt Retry payment
    App->>API: POST .../retry-payment
    API-->>App: checkoutPageUrl
    App->>App: Open PhonePe checkout
  else Clear survey
    App->>App: Confirm dialog "Remove this survey?"
    App->>API: POST .../clear
    API-->>App: Survey upload removed
    App->>App: Go to new submission / orders list
  end
```

**Recommended:** Show a confirmation dialog before Clear:

> “Remove this survey? This cannot be undone. You can submit a new survey afterwards.”

---

## Error responses

| HTTP | `code` | Meaning |
|------|--------|---------|
| 400 | `SKETCH_ALREADY_PAID` | Payment completed — cannot delete |
| 400 | `SKETCH_NOT_CLEARABLE` | Upload is not in unpaid payment state |
| 400 | `SKETCH_IN_WORKFLOW` | Already assigned to CAD |
| 403 | `NOT_YOUR_SKETCH` | Wrong surveyor |
| 404 | `SURVEY_SKETCH_NOT_FOUND` | Invalid or already deleted `uploadId` |

```json
{
  "success": false,
  "message": "Cannot clear a survey that has already been paid",
  "code": "SKETCH_ALREADY_PAID"
}
```

---

## Example: JavaScript

```javascript
const API_BASE = "https://m8earcixrb.execute-api.ap-south-1.amazonaws.com";

export function canClearSketchUpload(upload) {
  return (
    upload?.status === "PAYMENT_PENDING" &&
    upload?.sketchPayment?.status !== "COMPLETED"
  );
}

export async function clearSketchUpload(token, uploadId) {
  const res = await fetch(
    `${API_BASE}/api/surveyor/sketch-uploads/${uploadId}/clear`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Clear failed");
  return json.data;
}
```

---

## Related APIs

| Button | API |
|--------|-----|
| **Retry payment** | `POST /api/surveyor/sketch-uploads/{uploadId}/retry-payment` |
| **Clear** | `POST /api/surveyor/sketch-uploads/{uploadId}/clear` |
| **View status** | `GET /api/surveyor/sketch-uploads/{uploadId}` |
| **List orders** | `GET /api/surveyor/orders` |

See also: `docs/FRONTEND_SKETCH_PAYMENT_RETRY.md`

---

## UI checklist

- [ ] Clear only visible when `canClearSketchUpload(upload)`
- [ ] Confirmation modal before delete
- [ ] Disable button while request is in flight
- [ ] On success, remove from list and redirect
- [ ] On `SKETCH_ALREADY_PAID`, hide Clear and show order status instead
