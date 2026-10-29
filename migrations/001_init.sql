-- Ledger schema: accounts, transfers, transactions.
--
-- Integrity rules are enforced HERE (not only in application code) so they hold
-- no matter which code path writes the data.

-- ---------------------------------------------------------------------------
-- accounts
-- ---------------------------------------------------------------------------
CREATE TABLE accounts (
  id          BIGSERIAL     PRIMARY KEY,
  name        TEXT          NOT NULL,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT accounts_name_not_blank       CHECK (char_length(btrim(name)) > 0),
  -- Safety net: even a buggy code path can never overdraw an account.
  CONSTRAINT accounts_balance_non_negative CHECK (balance >= 0)
);

-- ---------------------------------------------------------------------------
-- transfers: links the debit leg and the credit leg of a money transfer
-- ---------------------------------------------------------------------------
CREATE TABLE transfers (
  id               BIGSERIAL     PRIMARY KEY,
  from_account_id  BIGINT        NOT NULL REFERENCES accounts (id),
  to_account_id    BIGINT        NOT NULL REFERENCES accounts (id),
  amount           NUMERIC(14,2) NOT NULL,
  description      TEXT,
  reference_id     TEXT          NOT NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT transfers_amount_positive     CHECK (amount > 0),
  CONSTRAINT transfers_distinct_accounts   CHECK (from_account_id <> to_account_id),
  CONSTRAINT transfers_reference_not_blank CHECK (char_length(btrim(reference_id)) > 0),
  CONSTRAINT transfers_reference_unique    UNIQUE (from_account_id, reference_id)
);

-- ---------------------------------------------------------------------------
-- transactions: the immutable ledger
-- ---------------------------------------------------------------------------
CREATE TABLE transactions (
  id            BIGSERIAL     PRIMARY KEY,
  account_id    BIGINT        NOT NULL REFERENCES accounts (id),
  transfer_id   BIGINT        REFERENCES transfers (id),
  type          TEXT          NOT NULL,
  amount        NUMERIC(14,2) NOT NULL,
  description   TEXT,
  reference_id  TEXT          NOT NULL,
  -- clock_timestamp() (not now()) so the value is taken at INSERT time, i.e. after the
  -- account row lock is acquired. That keeps created_at monotonic per account even when
  -- concurrent requests start in a different order than they commit.
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT transactions_type_valid          CHECK (type IN ('credit', 'debit')),
  CONSTRAINT transactions_amount_positive     CHECK (amount > 0),
  CONSTRAINT transactions_reference_not_blank CHECK (char_length(btrim(reference_id)) > 0),
  -- Duplicate reference_id is only a conflict within the SAME account.
  CONSTRAINT transactions_account_reference_unique UNIQUE (account_id, reference_id)
);

-- Serves "latest first" pagination: WHERE account_id = ? ORDER BY created_at DESC, id DESC
CREATE INDEX transactions_account_created_idx ON transactions (account_id, created_at DESC, id DESC);
CREATE INDEX transactions_transfer_idx        ON transactions (transfer_id) WHERE transfer_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Immutability: ledger rows can never be UPDATEd or DELETEd, by anyone.
-- ---------------------------------------------------------------------------
CREATE FUNCTION forbid_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER transactions_immutable
  BEFORE UPDATE OR DELETE ON transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();

CREATE TRIGGER transfers_immutable
  BEFORE UPDATE OR DELETE ON transfers
  FOR EACH ROW EXECUTE FUNCTION forbid_ledger_mutation();
