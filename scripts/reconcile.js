// Verifies the core invariant:  account.balance == SUM(credits) - SUM(debits)  for EVERY account.
// Exit code 0 = all consistent, 1 = mismatch found.
const { pool } = require('../src/config/db');

const SQL = `
  SELECT a.id,
         a.balance,
         COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0) AS ledger_balance
    FROM accounts a
    LEFT JOIN transactions t ON t.account_id = a.id
   GROUP BY a.id, a.balance
  HAVING a.balance <> COALESCE(SUM(CASE WHEN t.type = 'credit' THEN t.amount ELSE -t.amount END), 0)
   ORDER BY a.id`;

(async () => {
  try {
    const total = await pool.query('SELECT count(*) AS n FROM accounts');
    const { rows } = await pool.query(SQL);
    if (rows.length === 0) {
      console.log(`OK: all ${total.rows[0].n} account balance(s) match their transaction history.`);
    } else {
      console.error('MISMATCH found:');
      console.table(rows);
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
