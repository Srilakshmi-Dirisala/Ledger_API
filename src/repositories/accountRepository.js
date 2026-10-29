// SQL for the `accounts` table. Every function takes `db` (the pool OR a transaction client) first,
// so the same query can run standalone or inside a service-controlled transaction.

const COLUMNS = 'id, name, balance, created_at';

async function insert(db, name) {
  const { rows } = await db.query(
    `INSERT INTO accounts (name) VALUES ($1) RETURNING ${COLUMNS}`,
    [name]
  );
  return rows[0];
}

async function findById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM accounts WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** Row-locks one account until the surrounding transaction ends. */
async function lockById(db, id) {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM accounts WHERE id = $1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

/**
 * Row-locks several accounts in ascending id order. Always locking in the same order is what
 * prevents deadlocks between opposite transfers (A->B and B->A running at the same time).
 */
async function lockByIds(db, ids) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM accounts WHERE id = ANY($1::bigint[]) ORDER BY id FOR UPDATE`,
    [ids]
  );
  return rows;
}

/** balance = balance + amount. Returns the new balance. Caller must hold the row lock. */
async function credit(db, id, amount) {
  const { rows } = await db.query(
    'UPDATE accounts SET balance = balance + $2::numeric WHERE id = $1 RETURNING balance',
    [id, amount]
  );
  return rows[0].balance;
}

/**
 * balance = balance - amount, but ONLY if the balance covers it (the check and the write are
 * one statement, evaluated by PostgreSQL on exact NUMERIC values).
 * Returns the new balance, or null when the balance is insufficient (nothing is changed).
 */
async function debitIfSufficient(db, id, amount) {
  const { rows } = await db.query(
    `UPDATE accounts SET balance = balance - $2::numeric
      WHERE id = $1 AND balance >= $2::numeric
      RETURNING balance`,
    [id, amount]
  );
  return rows.length === 1 ? rows[0].balance : null;
}

async function count(db) {
  const { rows } = await db.query('SELECT count(*) AS total FROM accounts');
  return rows[0].total;
}

async function findPage(db, limit, offset) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM accounts ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

module.exports = { insert, findById, lockById, lockByIds, credit, debitIfSufficient, count, findPage };
