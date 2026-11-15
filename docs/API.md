# REST API Specification

The Merchant Payout Service exposes a structured RESTful API under the `/api` prefix.

---

## 1. Global Standards & Protocols

### 1.1 Base URL & Interactive Documentation
* **Base URL:** `http://localhost:${PORT:-3001}/api`
* **Swagger UI:** `http://localhost:${PORT:-3001}/api/docs` (also available at `/api/doc` and `/docs`)
* **OpenAPI 3.0 Spec:** `http://localhost:${PORT:-3001}/api/docs-json`

### 1.2 Authentication Headers

| Header | Format | Scope | Description |
| :--- | :--- | :--- | :--- |
| **`X-API-Key`** | `string` | Merchant APIs | Merchant authentication token (e.g. `test_key_acme_...`). Only its SHA-256 hash is stored. |
| **`Idempotency-Key`** | `string (8-64 chars)` | `POST /api/payouts` | Unique request identifier matching `/^[A-Za-z0-9_-]{8,64}$/`. |
| **`X-Bank-Signature`** | `sha256=<hex>` | `POST /api/webhooks/bank` | HMAC-SHA256 signature calculated over the raw request body using the shared webhook secret. |
| **`X-Admin-Token`** | `string` | `POST /api/admin/*` | Operator token for administrative and reconciliation operations. |

---

## 2. Standard Enterprise Response Envelopes

Every endpoint returns a consistent JSON envelope.

### 2.1 Success Envelope
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "path": "/api/payouts",
  "timestamp": "2026-11-15T12:00:00.000Z"
}
```

### 2.2 Error Envelope
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation failed",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "amount_paise",
        "issue": "amount_paise must be at least 100 (INR 1)"
      }
    ]
  },
  "path": "/api/payouts",
  "timestamp": "2026-11-15T12:00:00.000Z"
}
```

### 2.3 Error Code Catalog

| HTTP Status | Error Code | Description |
| :--- | :--- | :--- |
| **400** | `VALIDATION_ERROR` | Request body or query parameters failed validation constraints. |
| **400** | `INVALID_IDEMPOTENCY_KEY` | Missing or malformed `Idempotency-Key` header. |
| **401** | `UNAUTHENTICATED` | Missing or invalid `X-API-Key` or `X-Admin-Token`. |
| **401** | `INVALID_SIGNATURE` | Webhook HMAC-SHA256 signature verification failed. |
| **404** | `PAYOUT_NOT_FOUND` | Payout does not exist or belongs to another merchant. |
| **409** | `IDEMPOTENCY_KEY_REUSED` | Same idempotency key was previously used with a different request payload. |
| **422** | `INSUFFICIENT_FUNDS` | Wallet available balance is lower than requested payout amount. |
| **500** | `INTERNAL_ERROR` | An unexpected internal server error occurred. Sensitive details are redacted. |

---

## 3. Endpoints

### 3.1 Payouts

#### `POST /api/payouts`
Initiate a payout to a beneficiary.

* **Headers:**
  - `X-API-Key`: Required
  - `Idempotency-Key`: Required (8–64 alphanumeric characters, `_` or `-`)
  - `Content-Type`: `application/json`
* **Request Body:**
  ```json
  {
    "beneficiary_ref": "BEN_ACME_001",
    "amount_paise": 2500000
  }
  ```
* **Validation Rules:**
  - `beneficiary_ref`: Required string, 3–64 characters matching `/^[A-Za-z0-9_-]{3,64}$/`.
  - `amount_paise`: Required integer, minimum `100` (INR 1), maximum `1000000000` (INR 1 crore).
* **Responses:**
  - `201 Created`: Payout initiated successfully.
  - `200 OK`: Idempotent replay of previously processed payout (`Idempotent-Replayed: true` header attached).
  - `400 Bad Request`: Validation failure.
  - `409 Conflict`: Reused idempotency key with conflicting payload.
  - `422 Unprocessable Entity`: Insufficient available wallet balance.

* **Response Example:**
  ```json
  {
    "success": true,
    "statusCode": 201,
    "message": "Success",
    "data": {
      "id": "c7193789-6d8a-4385-be23-d23ab361c3fa",
      "status": "SUCCESS",
      "amount_paise": 2500000,
      "currency": "INR",
      "beneficiary_ref": "***********0001",
      "idempotency_key": "order-1001-payout",
      "bank_reference": "BNK-c7193789-6d8a-4385-be23-d23ab361c3fa",
      "failure_reason": null,
      "created_at": "2026-11-15T12:00:00.000Z",
      "updated_at": "2026-11-15T12:00:00.000Z"
    },
    "path": "/api/payouts",
    "timestamp": "2026-11-15T12:00:00.000Z"
  }
  ```

---

#### `GET /api/payouts/:id`
Retrieve details of a single payout owned by the authenticated merchant.

* **Headers:**
  - `X-API-Key`: Required
* **URL Parameters:**
  - `id`: UUID of the payout
* **Responses:**
  - `200 OK`: Payout details returned.
  - `404 Not Found`: Payout does not exist or is owned by another merchant.

---

### 3.2 Wallet & Transactions

#### `GET /api/wallet`
Retrieve the authenticated merchant's balance snapshot.

* **Headers:**
  - `X-API-Key`: Required
* **Response Example:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Success",
    "data": {
      "available_paise": 7500000,
      "reserved_paise": 2500000,
      "updated_at": "2026-11-15T12:00:00.000Z"
    },
    "path": "/api/wallet",
    "timestamp": "2026-11-15T12:00:00.000Z"
  }
  ```

---

#### `GET /api/transactions`
List ledger entries for the authenticated merchant, newest first.

* **Headers:**
  - `X-API-Key`: Required
* **Query Parameters:**
  - `status`: Optional filter by associated payout status (`PROCESSING`, `PENDING`, `UNKNOWN`, `SUCCESS`, `FAILED`).
  - `type`: Optional filter by ledger entry type (`CREDIT`, `PAYOUT_RESERVE`, `PAYOUT_SETTLE`, `PAYOUT_REVERSAL`).
  - `page`: Page number (integer >= 1, default `1`).
  - `limit`: Items per page (integer 1–100, default `20`).
* **Response Example:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Success",
    "data": {
      "data": [
        {
          "id": 12,
          "type": "PAYOUT_SETTLE",
          "amount_paise": 2500000,
          "available_after_paise": 7500000,
          "reserved_after_paise": 0,
          "description": "Payout settled",
          "created_at": "2026-11-15T12:00:00.000Z",
          "payout_id": "c7193789-6d8a-4385-be23-d23ab361c3fa",
          "payout_status": "SUCCESS"
        }
      ],
      "total": 1,
      "page": 1,
      "limit": 20
    },
    "path": "/api/transactions",
    "timestamp": "2026-11-15T12:00:00.000Z"
  }
  ```

---

### 3.3 Webhooks

#### `POST /api/webhooks/bank`
Inbound webhook callback from the banking partner.

* **Headers:**
  - `X-Bank-Signature`: Required HMAC-SHA256 signature (`sha256=<hex_digest>`)
  - `Content-Type`: `application/json`
* **Request Body:**
  ```json
  {
    "event_id": "evt-bank-9901",
    "bank_reference": "BNK-c7193789-6d8a-4385-be23-d23ab361c3fa",
    "status": "SUCCESS"
  }
  ```
* **Validation Rules:**
  - `status`: Strictly one of `'SUCCESS' | 'FAILED' | 'PENDING'`.
* **Responses:**
  - `200 OK`: `{"success": true, "data": {"result": "APPLIED"}}`
  - `200 OK`: `{"success": true, "data": {"result": "DUPLICATE"}}` (event previously processed)
  - `200 OK`: `{"success": true, "data": {"result": "NO_CHANGE"}}` (payout already in target state)
  - `200 OK`: `{"success": true, "data": {"result": "UNKNOWN_REFERENCE"}}` (no local payout for reference)
  - `401 Unauthorized`: Invalid or missing signature.

---

### 3.4 Administration & Reconciliation

#### `POST /api/admin/reconcile`
Trigger reconciliation against bank records.

* **Headers:**
  - `X-Admin-Token`: Required
* **Query Parameters:**
  - `dry_run`: Boolean (`true` to preview actions without applying database changes; default `false`).
* **Response Example:**
  ```json
  {
    "success": true,
    "statusCode": 200,
    "message": "Success",
    "data": {
      "dry_run": false,
      "checked": 15,
      "matched": 13,
      "resolved": [
        {
          "payout_id": "c7193789-6d8a-4385-be23-d23ab361c3fa",
          "from": "UNKNOWN",
          "to": "SUCCESS",
          "applied": true
        }
      ],
      "manual_review": [],
      "errors": []
    },
    "path": "/api/admin/reconcile",
    "timestamp": "2026-11-15T12:00:00.000Z"
  }
  ```
