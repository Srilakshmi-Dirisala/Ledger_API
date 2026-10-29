// SQL for the `transactions` table (append-only: there is intentionally no update/delete here).

const COLUMNS =
  'id, account_id, transfer_id, type, amount, description, reference_id, created_at';

async function insert(db, { accountId, transferId = null, type, amount, description, referenceId }) {
  const { rows } = await db.query(
    `INSERT INTO transactions (account_id, transfer_id, type, amount, description, reference_id)
     VALUES ($1, $2, $3, $4::numeric, $5, $6)
     RETURNING ${COLUMNS}`,
    [accountId, transferId, type, amount, description, referenceId]
  );
  return rows[0];
}

/** Which of these accounts already used this reference_id? Returns [{ account_id, id }]. */
async function findByReference(db, accountIds, referenceId) {
  const { rows } = await db.query(
    `SELECT account_id, id FROM transactions
      WHERE reference_id = $2 AND account_id = ANY($1::bigint[])
      ORDER BY account_id`,
    [accountIds, referenceId]
  );
  return rows;
}

async function findById(db, accountId, transactionId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM transactions WHERE account_id = $1 AND id = $2`,
    [accountId, transactionId]
  );
  return rows[0] || null;
}

async function countByAccount(db, accountId) {
  const { rows } = await db.query(
    'SELECT count(*) AS total FROM transactions WHERE account_id = $1',
    [accountId]
  );
  return rows[0].total;
}

/** Latest first. `id DESC` is a tie-breaker so ordering is stable for identical timestamps. */
async function findPageByAccount(db, accountId, limit, offset) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM transactions
      WHERE account_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3`,
    [accountId, limit, offset]
  );
  return rows;
}

module.exports = { insert, findByReference, findById, countByAccount, findPageByAccount };
