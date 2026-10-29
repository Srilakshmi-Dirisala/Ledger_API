const COLUMNS = 'id, from_account_id, to_account_id, amount, description, reference_id, created_at';

async function insert(db, { fromAccountId, toAccountId, amount, description, referenceId }) {
  const { rows } = await db.query(
    `INSERT INTO transfers (from_account_id, to_account_id, amount, description, reference_id)
     VALUES ($1, $2, $3::numeric, $4, $5)
     RETURNING ${COLUMNS}`,
    [fromAccountId, toAccountId, amount, description, referenceId]
  );
  return rows[0];
}

module.exports = { insert };
