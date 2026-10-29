# Assumptions & Design Decisions

The brief left some details open. These are the choices I made, so a reviewer can see them at a glance.

## Scope

1. **Core endpoints.** The basics are taken to be: create an account, read an account and its balance,
   create a transaction for an account, and list an account's transactions. All four are implemented.
   Extras: `GET /accounts` (list), `GET .../transactions/:id` (single transaction), `GET /health`.
2. **Backend only.** The brief asks for a backend technology, an API, a README and API docs. No UI is included.
3. **No authentication/authorisation.** Not requested; any caller can use any account. In production
   this would sit behind auth, and an account would belong to an owner.

## Accounts

4. A new account **always starts at balance 0** and the client cannot set a balance
   (an unknown `balance` field is rejected with 400). Money only enters through a credit transaction.
5. Account **name** is required, trimmed, 1-100 characters. Names need not be unique.
6. There is no endpoint to edit or delete an account (none was requested; the database also refuses to
   delete an account that has transactions).

## Money

7. **Single currency**, amounts in major units with **at most 2 decimal places** (e.g. `19.99`).
8. Stored as `NUMERIC(14,2)` (never floating point). Maximum amount/balance is **999,999,999,999.99**.
   A credit that would push a balance past this is rejected (`422 AMOUNT_OUT_OF_RANGE`).
9. `amount` must be a **JSON number** > 0. Numeric strings such as `"10"` are rejected on purpose,
   to avoid ambiguity. Amounts with more than 2 decimals (e.g. `1.005`) are rejected, never silently rounded.
10. A **balance can never go negative** (no overdraft). A debit of exactly the full balance is allowed.

## Transactions

11. Fields: `type` (`credit`/`debit`, lowercase, exact), `amount`, optional `description`
    (max 500 chars), required `reference_id` (trimmed, 1-100 chars).
12. `id` and `created_at` are **server-generated**; a client cannot supply them
    (unknown fields are rejected with 400, never silently ignored).
13. **Immutable:** there are no PUT/PATCH/DELETE endpoints (they return `405 TRANSACTION_IMMUTABLE`),
    and a database trigger blocks `UPDATE`/`DELETE` even from raw SQL. Mistakes are corrected by
    posting a new offsetting transaction, as in real accounting ledgers. (A database superuser could
    still drop the trigger or `TRUNCATE`; production would use a restricted application role.)
14. **Duplicate `reference_id`:** unique **per account** (the same value on two different accounts is fine).
    Reusing it on the same account returns **409 `DUPLICATE_TRANSACTION`** with the original transaction's
    id in `details`; the second request does **not** change the balance. I chose 409 rather than
    "return the original with 200" so a client never mistakes a retry for a new success. The duplicate
    check runs *before* the balance check, so retrying a debit that already succeeded reports a duplicate
    rather than a confusing "insufficient balance".
15. `reference_id` is unique across both transaction types (a credit and a debit cannot share one).

## Listing & pagination

16. `GET /accounts/:id/transactions` accepts `page` (default **1**) and `limit` (default **10**, max **100**).
    Response metadata: `current_page`, `page_size`, `total_records`, `total_pages`.
17. Order is **latest first** by `created_at`, with `id` descending as a tie-breaker.
18. A page beyond the last page is **not an error**: it returns `200` with an empty `data` array and
    correct metadata. An account with no transactions has `total_pages: 0`.
    Non-numeric, zero, negative, fractional, repeated or out-of-range `page`/`limit` return `400 INVALID_PAGINATION`.
19. Offset pagination is used for simplicity. For very large ledgers, keyset (cursor) pagination
    would scale better.

## Errors

20. Every error has the same shape: `{ "error": { "code", "message", "details": [] } }`.
21. Status codes: `400` validation/malformed input, `404` account/transaction/route not found,
    `405` method not allowed, `409` duplicate reference, `415` non-JSON body, `422` insufficient balance
    or out-of-range result, `500` unexpected (internals are never leaked).
22. A **malformed** account id (`/accounts/abc`) returns `400 INVALID_ACCOUNT_ID`; a **well-formed id
    that does not exist** returns `404 ACCOUNT_NOT_FOUND`.

## Transfers (bonus)

23. `POST /transfers` takes `from_account_id`, `to_account_id`, `amount`, `reference_id`, optional `description`.
24. A transfer creates one `transfers` row plus **two ledger transactions** (a debit on the source, a credit on
    the destination), both carrying the same `reference_id` and a shared `transfer_id`. They appear in each
    account's normal history.
25. Source and destination must be different accounts (400 otherwise). The `reference_id` must be unused on
    **both** accounts, otherwise 409 and nothing moves.
26. Transfers between accounts are atomic: the debit, the credit and the records are committed together or not at all.
27. There is no currency conversion and no transfer-specific endpoints beyond create (the debit/credit legs are
    readable through the transaction endpoints).

## Concurrency

28. Requests touching the same account are serialised with a row lock; requests on different accounts run in
    parallel. Transfers lock both accounts in ascending-id order to prevent deadlocks.
29. Under extreme contention a request may wait briefly for the lock; there is no lock timeout configured.

## Operational

30. Schema changes are plain SQL files in `migrations/`, applied in order by `npm run migrate`
    (tracked in a `schema_migrations` table). The server will not start if tables are missing.
31. Timestamps are stored as `timestamptz` and returned as ISO-8601 UTC strings (millisecond precision in JSON).
