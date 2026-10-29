# Ledger API: Accounts, Transactions & Transfers

A REST API for managing accounts and an immutable transaction ledger, with atomic balance
updates, pagination, validation, consistent error handling and the bonus money-transfer endpoint.

- **Stack:** Node.js 18+ · Express 4 · PostgreSQL 16 · zod (validation) · Jest + Supertest (tests)
- **Docs:** [API documentation](docs/API.md) · [Assumptions](ASSUMPTIONS.md)

---

## 1. Prerequisites

| Tool | Version | Check with |
|---|---|---|
| Node.js | 18 or newer | `node -v` |
| npm | comes with Node | `npm -v` |
| PostgreSQL | 13 or newer (16 recommended) | via Docker **or** a local install |
| Docker (optional) | any recent | `docker -v` |

## 2. Quick start (Docker for the database)

```bash
# 1. Install dependencies
npm install

# 2. Create your env file (defaults already match docker-compose.yml)
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env

# 3. Start PostgreSQL (creates databases "ledger" and "ledger_test")
docker compose up -d

# 4. Create the tables
npm run migrate

# 5. Start the API  ->  http://localhost:3000
npm start
```

Check it works:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### Don't have Docker? Use a local PostgreSQL instead

```bash
createdb ledger
createdb ledger_test
```

Then edit `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` to match your username/password
(e.g. `postgres://myuser:mypass@localhost:5432/ledger`) and continue from step 4 above.

## 3. Try it

With the server running, in a second terminal:

```bash
npm run demo
```

This script replays the assessment examples against the live API and prints every response:
the `+100 +50 -30 -20 = 100` balance example, rejected requests, pagination, immutability, and a
transfer (`A=100, B=50, move 30 -> A=70, B=80`).

Or use curl directly:

```bash
# create an account
curl -X POST localhost:3000/accounts -H "Content-Type: application/json" -d '{"name":"Savings"}'

# credit 100
curl -X POST localhost:3000/accounts/1/transactions -H "Content-Type: application/json" \
  -d '{"type":"credit","amount":100,"description":"Deposit","reference_id":"dep-001"}'

# list transactions (latest first, paginated)
curl "localhost:3000/accounts/1/transactions?page=1&limit=10"
```

(PowerShell users: use `curl.exe` and put the JSON in single quotes with escaped inner quotes, or use Postman.)

## 4. Run the tests

```bash
npm test
```

130 tests cover the happy paths, every validation rule, every error status, pagination, immutability
(API **and** database level), atomic rollback on simulated crashes, and concurrency (parallel debits,
parallel duplicate references, opposite transfers at the same time).

Tests use the separate `ledger_test` database and **TRUNCATE its tables**. The suite refuses to start
unless the database name ends in `_test`, so it can never wipe your real data.

## 5. Verify data integrity yourself

```bash
npm run reconcile
```

Checks, for every account, that `balance == SUM(credits) - SUM(debits)` computed from the ledger.
Exits with code 1 and prints the offending accounts if anything is off.

## 6. API at a glance

| Method | Path | Purpose | Success |
|---|---|---|---|
| `POST` | `/accounts` | Create an account (balance starts at 0) | 201 |
| `GET` | `/accounts` | List accounts (paginated) | 200 |
| `GET` | `/accounts/:accountId` | Get an account with its current balance | 200 |
| `POST` | `/accounts/:accountId/transactions` | Create a credit or debit | 201 |
| `GET` | `/accounts/:accountId/transactions?page=&limit=` | List transactions, latest first, paginated | 200 |
| `GET` | `/accounts/:accountId/transactions/:transactionId` | Get one transaction | 200 |
| `POST` | `/transfers` | **Bonus:** atomic transfer between two accounts | 201 |
| `GET` | `/health` | Liveness + DB check | 200 |

`PUT` / `PATCH` / `DELETE` on a transaction are refused with `405 TRANSACTION_IMMUTABLE`.
Full request/response examples and all error codes are in **[docs/API.md](docs/API.md)**.

## 7. Project structure

```
ledger-api/
├── migrations/001_init.sql        # schema, constraints, immutability triggers
├── src/
│   ├── server.js                  # starts HTTP server, graceful shutdown
│   ├── app.js                     # express app wiring (routes + error handling)
│   ├── config/                    # env.js, db.js (pool + transaction helpers)
│   ├── routes/                    # URL -> controller mapping, 405 handling
│   ├── controllers/               # parse + validate request, shape the response
│   ├── validators/                # zod schemas + pagination / id parsing
│   ├── services/                  # business rules + database transactions
│   ├── repositories/              # all SQL lives here
│   ├── middleware/                # error handler, 404/405, JSON guard, logging
│   ├── errors/AppError.js         # typed errors -> HTTP status + code
│   ├── db/migrate.js              # tiny migration runner
│   └── utils/                     # pagination helper, logger
├── scripts/                       # migrate.js, reconcile.js, demo.js
├── tests/                         # Jest + Supertest
├── docs/API.md                    # API documentation
├── ASSUMPTIONS.md
├── docker-compose.yml
└── .env.example
```

Request flow: **route → controller (validate) → service (rules + DB transaction) → repository (SQL)**.

## 8. How each integrity requirement is met

| Requirement | How |
|---|---|
| **Atomicity**: ledger row + balance change are one operation | The service runs both inside a single PostgreSQL transaction (`withTransaction` in `src/config/db.js`). Any error triggers `ROLLBACK`. Tests simulate a crash after the balance update and prove nothing is persisted. |
| **Balance consistency** | Balance is only ever changed in the same transaction that inserts the matching ledger row, using exact `NUMERIC(14,2)` arithmetic inside PostgreSQL (never JS floats). `npm run reconcile` and the tests assert `balance == credits - debits`. |
| **Rejected transactions don't affect balance** | Validation, duplicate and balance checks all run before/inside the transaction; a failure rolls back, so the row and the balance never change. |
| **No overdrafts, even under concurrency** | The account row is locked (`SELECT ... FOR UPDATE`) and debits use a single conditional `UPDATE ... WHERE balance >= amount`. A `CHECK (balance >= 0)` constraint is the final safety net. 20 parallel debits against a balance of 100 → exactly 10 succeed. |
| **Transaction immutability** | No update/delete routes (405), **and** a database trigger rejects any `UPDATE`/`DELETE` on `transactions` (and `transfers`) even from raw SQL. |
| **Duplicate `reference_id`** | `UNIQUE (account_id, reference_id)` plus an explicit check under the account lock → `409 DUPLICATE_TRANSACTION`. Parallel duplicates: one wins, the rest get 409. |
| **Transfers are all-or-nothing** | Debit, credit, transfer record and both ledger rows are in one DB transaction. Accounts are locked in ascending-id order, so opposite transfers cannot deadlock. |
| **Latest-first ordering** | `ORDER BY created_at DESC, id DESC`. `created_at` defaults to `clock_timestamp()` (taken at insert time under the account lock) so it is monotonic per account; `id` breaks ties. |
| **Consistent page + total** | Count and page are read in one `REPEATABLE READ` snapshot, so they always agree. |

## 9. Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/ledger` | main database |
| `TEST_DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/ledger_test` | database used by `npm test` (name must end in `_test`) |
| `DB_POOL_SIZE` | `10` | max DB connections |

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to PostgreSQL ...` on `npm start` | Start the DB (`docker compose up -d`) or fix `DATABASE_URL`. |
| `Database tables are missing. Run npm run migrate first.` | Run `npm run migrate`. |
| `database "ledger_test" does not exist` when testing | `docker compose exec db createdb -U postgres ledger_test` (the init script only runs on the first container start) or `createdb ledger_test`. |
| `port 5432 already in use` | A local Postgres is already running: use it (see "Don't have Docker?") or change the host port in `docker-compose.yml` and in `.env`. |
| `EADDRINUSE :3000` | Set `PORT=3001` in `.env`. |
| Reset everything | `docker compose down -v && docker compose up -d && npm run migrate` |

## 11. Scripts

| Command | What it does |
|---|---|
| `npm start` | Run the API |
| `npm run dev` | Run with auto-restart on file changes |
| `npm run migrate` | Apply pending SQL migrations |
| `npm test` | Run all tests |
| `npm run demo` | Replay the assessment scenarios against a running server |
| `npm run reconcile` | Verify all balances against the ledger |
