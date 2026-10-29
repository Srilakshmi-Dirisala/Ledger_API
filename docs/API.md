# API Documentation

Base URL (local): `http://localhost:3000`

- All request and response bodies are **JSON**. Send `Content-Type: application/json` on `POST` requests.
- Money amounts are JSON **numbers** with at most 2 decimal places (e.g. `19.99`).
- Timestamps are ISO-8601 UTC strings. Ids are integers.
- Successful responses wrap the payload in `data`. List responses also include `pagination`.
- Errors always use the [standard error shape](#errors).

## Endpoints

| Method | Path | Description | Success |
|---|---|---|---|
| POST | [`/accounts`](#post-accounts) | Create an account | 201 |
| GET | [`/accounts`](#get-accounts) | List accounts (paginated) | 200 |
| GET | [`/accounts/:accountId`](#get-accountsaccountid) | Get an account and its balance | 200 |
| POST | [`/accounts/:accountId/transactions`](#post-accountsaccountidtransactions) | Create a credit/debit | 201 |
| GET | [`/accounts/:accountId/transactions`](#get-accountsaccountidtransactions) | List transactions (latest first, paginated) | 200 |
| GET | [`/accounts/:accountId/transactions/:transactionId`](#get-accountsaccountidtransactionstransactionid) | Get one transaction | 200 |
| POST | [`/transfers`](#post-transfers-bonus) | Transfer money between accounts (bonus) | 201 |
| GET | `/health` | Health check | 200 |

`PUT`, `PATCH` and `DELETE` on transactions are intentionally unsupported: see [Immutability](#immutability).

---

## POST /accounts

Creates an account. The balance always starts at `0`.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `name` | string | yes | trimmed, 1-100 characters |

```bash
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Savings"}'
```

**201 Created** (also sets a `Location: /accounts/1` header)

```json
{
  "data": {
    "id": 1,
    "name": "Savings",
    "balance": 0,
    "created_at": "2026-10-29T06:48:12.866Z"
  }
}
```

**Errors:** `400 VALIDATION_ERROR` (name missing/blank/too long/not a string, or unknown field such as `balance`),
`400 INVALID_REQUEST_BODY` (malformed JSON), `415 UNSUPPORTED_MEDIA_TYPE`.

---

## GET /accounts

Lists accounts, newest first. Supports `?page=&limit=` (see [Pagination](#pagination)).

```bash
curl "http://localhost:3000/accounts?page=1&limit=10"
```

**200 OK**

```json
{
  "data": [
    { "id": 2, "name": "Checking", "balance": 70, "created_at": "2026-10-29T06:48:12.940Z" },
    { "id": 1, "name": "Savings", "balance": 100, "created_at": "2026-10-29T06:48:12.866Z" }
  ],
  "pagination": { "current_page": 1, "page_size": 10, "total_records": 2, "total_pages": 1 }
}
```

---

## GET /accounts/:accountId

```bash
curl http://localhost:3000/accounts/1
```

**200 OK**

```json
{
  "data": { "id": 1, "name": "Savings", "balance": 100, "created_at": "2026-10-29T06:48:12.866Z" }
}
```

`balance` always equals the sum of the account's credits minus the sum of its debits.

**Errors:** `400 INVALID_ACCOUNT_ID` (not a positive integer), `404 ACCOUNT_NOT_FOUND`.

---

## POST /accounts/:accountId/transactions

Creates a credit or a debit **and** updates the account balance as one atomic operation.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `type` | string | yes | exactly `"credit"` or `"debit"` |
| `amount` | number | yes | greater than 0, at most 2 decimal places, at most `999999999999.99` |
| `reference_id` | string | yes | trimmed, 1-100 chars; unique **per account** |
| `description` | string | no | up to 500 chars; blank/`null` is stored as `null` |

Unknown fields (including `id`, `account_id`, `created_at`) are rejected.

```bash
curl -X POST http://localhost:3000/accounts/1/transactions \
  -H "Content-Type: application/json" \
  -d '{"type":"credit","amount":100,"description":"Deposit","reference_id":"dep-001"}'
```

**201 Created** (also sets `Location: /accounts/1/transactions/1`)

```json
{
  "data": {
    "id": 1,
    "account_id": 1,
    "transfer_id": null,
    "type": "credit",
    "amount": 100,
    "description": "Deposit",
    "reference_id": "dep-001",
    "created_at": "2026-10-29T06:48:12.880Z"
  },
  "account": { "id": 1, "balance": 100 }
}
```

`account.balance` is the balance right after this transaction.

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | invalid/missing `type`, `amount`, `reference_id`, `description`, or unknown field |
| 400 | `INVALID_ACCOUNT_ID` | `:accountId` is not a positive integer |
| 400 | `INVALID_REQUEST_BODY` | malformed JSON |
| 404 | `ACCOUNT_NOT_FOUND` | no such account |
| 409 | `DUPLICATE_TRANSACTION` | `reference_id` already used on this account |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | body is not JSON |
| 422 | `INSUFFICIENT_BALANCE` | debit larger than the current balance |
| 422 | `AMOUNT_OUT_OF_RANGE` | credit would exceed the maximum balance |

A rejected request never changes the balance and never creates a transaction.

Example, **insufficient balance** (`422`):

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Account 1 has insufficient balance for this debit",
    "details": [{ "account_id": 1, "available_balance": 100, "requested_amount": 1000 }]
  }
}
```

Example, **duplicate reference** (`409`):

```json
{
  "error": {
    "code": "DUPLICATE_TRANSACTION",
    "message": "A transaction with reference_id 'dep-001' already exists for account 1",
    "details": [
      { "field": "reference_id", "account_id": 1, "reference_id": "dep-001", "existing_transaction_id": 1 }
    ]
  }
}
```

Example, **validation** (`400`), every invalid field is reported at once:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      { "field": "type", "code": "INVALID_TRANSACTION_TYPE", "message": "type must be either 'credit' or 'debit'" },
      { "field": "amount", "code": "INVALID_AMOUNT", "message": "amount must be greater than 0" }
    ]
  }
}
```

---

## GET /accounts/:accountId/transactions

Returns the account's transactions, **latest first** (`created_at` descending), paginated.

| Query param | Default | Rules |
|---|---|---|
| `page` | `1` | integer 1 to 1,000,000 |
| `limit` | `10` | integer 1 to 100 |

```bash
curl "http://localhost:3000/accounts/1/transactions?page=1&limit=2"
```

**200 OK**

```json
{
  "data": [
    {
      "id": 4,
      "account_id": 1,
      "transfer_id": null,
      "type": "debit",
      "amount": 20,
      "description": "debit 20",
      "reference_id": "demo-debit-20",
      "created_at": "2026-10-29T06:48:12.903Z"
    },
    {
      "id": 3,
      "account_id": 1,
      "transfer_id": null,
      "type": "debit",
      "amount": 30,
      "description": "debit 30",
      "reference_id": "demo-debit-30",
      "created_at": "2026-10-29T06:48:12.898Z"
    }
  ],
  "pagination": { "current_page": 1, "page_size": 2, "total_records": 4, "total_pages": 2 }
}
```

**Errors:** `400 INVALID_PAGINATION`, `400 INVALID_ACCOUNT_ID`, `404 ACCOUNT_NOT_FOUND`.

---

## GET /accounts/:accountId/transactions/:transactionId

Returns one transaction (`200`, same object as in `data` above).
**Errors:** `400 INVALID_ACCOUNT_ID` / `INVALID_TRANSACTION_ID`, `404 ACCOUNT_NOT_FOUND`,
`404 TRANSACTION_NOT_FOUND` (also when the transaction belongs to a different account).

---

## POST /transfers (bonus)

Moves money from one account to another. The debit, the credit, the transfer record and both ledger rows
are committed **atomically**: if any part fails, nothing changes.

**Request body**

| Field | Type | Required | Rules |
|---|---|---|---|
| `from_account_id` | integer | yes | positive integer, must exist |
| `to_account_id` | integer | yes | positive integer, must exist, different from `from_account_id` |
| `amount` | number | yes | same rules as for transactions |
| `reference_id` | string | yes | must be unused on **both** accounts |
| `description` | string | no | defaults to "Transfer to/from account N" on the two ledger rows |

```bash
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{"from_account_id":2,"to_account_id":3,"amount":30,"description":"Demo transfer","reference_id":"tr-001"}'
```

**201 Created**: account 2 had 100 and account 3 had 50.

```json
{
  "data": {
    "id": 1,
    "from_account_id": 2,
    "to_account_id": 3,
    "amount": 30,
    "description": "Demo transfer",
    "reference_id": "tr-001",
    "created_at": "2026-10-29T06:48:12.962Z",
    "debit_transaction": {
      "id": 7, "account_id": 2, "transfer_id": 1, "type": "debit", "amount": 30,
      "description": "Demo transfer", "reference_id": "tr-001", "created_at": "2026-10-29T06:48:12.962Z"
    },
    "credit_transaction": {
      "id": 8, "account_id": 3, "transfer_id": 1, "type": "credit", "amount": 30,
      "description": "Demo transfer", "reference_id": "tr-001", "created_at": "2026-10-29T06:48:12.963Z"
    }
  },
  "accounts": {
    "from": { "id": 2, "balance": 70 },
    "to": { "id": 3, "balance": 80 }
  }
}
```

**Errors**

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | invalid body; also `from_account_id` equals `to_account_id` |
| 404 | `ACCOUNT_NOT_FOUND` | either account is missing (`details[0].value` is the missing id) |
| 409 | `DUPLICATE_TRANSACTION` | `reference_id` already used on the source or destination account |
| 422 | `INSUFFICIENT_BALANCE` | source balance is lower than `amount` |
| 422 | `AMOUNT_OUT_OF_RANGE` | destination balance would exceed the maximum |

---

## Pagination

List endpoints accept `page` (default 1) and `limit` (default 10, max 100) and return:

```json
"pagination": {
  "current_page": 2,
  "page_size": 2,
  "total_records": 5,
  "total_pages": 3
}
```

- `total_pages = ceil(total_records / page_size)` (`0` when there are no records).
- A page beyond the last one returns `200` with `"data": []` and the same metadata.
- Invalid values (`page=0`, `limit=101`, `page=abc`, `limit=-5`, `page=1.5`, repeated params) return
  `400 INVALID_PAGINATION` listing every bad parameter:

```json
{
  "error": {
    "code": "INVALID_PAGINATION",
    "message": "Invalid pagination parameters",
    "details": [
      { "field": "page", "code": "INVALID_PAGINATION", "message": "page must be between 1 and 1000000" },
      { "field": "limit", "code": "INVALID_PAGINATION", "message": "limit must be between 1 and 100" }
    ]
  }
}
```

## Immutability

A transaction cannot be changed or removed once created. `PUT`, `PATCH` or `DELETE` on
`/accounts/:id/transactions/:transactionId` return the response below. (The collection URL
`/accounts/:id/transactions` only supports `GET` and `POST`; other methods there return
`405 METHOD_NOT_ALLOWED` with `Allow: GET, POST`.)

```http
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
```
```json
{
  "error": {
    "code": "TRANSACTION_IMMUTABLE",
    "message": "Transactions are immutable: they cannot be modified or deleted",
    "details": []
  }
}
```

This is also enforced inside PostgreSQL by a trigger, so it holds even for direct SQL.
To correct a mistake, create a new offsetting transaction.

## Errors

Every error response has this shape and a matching HTTP status:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human readable explanation",
    "details": []
  }
}
```

`details` is always an array (possibly empty). For validation errors each entry is
`{ "field", "code", "message" }`.

| HTTP | `error.code` | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | request body failed validation (see `details`) |
| 400 | `INVALID_REQUEST_BODY` | body is not valid JSON |
| 400 | `INVALID_ACCOUNT_ID` | account id in the URL is not a positive integer |
| 400 | `INVALID_TRANSACTION_ID` | transaction id in the URL is not a positive integer |
| 400 | `INVALID_PAGINATION` | bad `page` / `limit` |
| 404 | `ACCOUNT_NOT_FOUND` | account does not exist |
| 404 | `TRANSACTION_NOT_FOUND` | transaction does not exist for that account |
| 404 | `ROUTE_NOT_FOUND` | unknown URL |
| 405 | `METHOD_NOT_ALLOWED` | method not supported on that URL (`Allow` header lists valid ones) |
| 405 | `TRANSACTION_IMMUTABLE` | attempt to modify/delete a transaction |
| 409 | `DUPLICATE_TRANSACTION` | `reference_id` already used on that account |
| 413 | `PAYLOAD_TOO_LARGE` | body over 100 KB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | body sent with a non-JSON content type |
| 422 | `INSUFFICIENT_BALANCE` | debit/transfer exceeds available balance |
| 422 | `AMOUNT_OUT_OF_RANGE` | result would exceed the maximum balance |
| 500 | `INTERNAL_ERROR` | unexpected server error (details are logged, never returned) |
| 503 | `DATABASE_UNAVAILABLE` | the database cannot be reached |

Field-level `details[].code` values used in `VALIDATION_ERROR`: `MISSING_FIELD`, `INVALID_NAME`,
`INVALID_TRANSACTION_TYPE`, `INVALID_AMOUNT`, `INVALID_REFERENCE_ID`, `INVALID_DESCRIPTION`,
`INVALID_ACCOUNT_ID`, `INVALID_BODY`, `UNKNOWN_FIELD`.

## Data model

```
accounts       id PK · name · balance NUMERIC(14,2) CHECK >= 0 · created_at
transfers      id PK · from_account_id FK · to_account_id FK · amount · description · reference_id · created_at
               CHECK amount > 0 · CHECK from <> to · UNIQUE (from_account_id, reference_id)
transactions   id PK · account_id FK · transfer_id FK null · type CHECK in (credit, debit) · amount CHECK > 0
               · description · reference_id · created_at
               UNIQUE (account_id, reference_id) · trigger blocks UPDATE/DELETE
```
