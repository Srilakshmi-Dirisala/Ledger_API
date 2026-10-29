const { Pool, types } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

// By default node-postgres returns BIGINT (oid 20) and NUMERIC (oid 1700) as strings.
// Ids stay far below 2^53 and money is limited to NUMERIC(14,2) (< 1e12), so plain JS numbers
// are exact for every value this API can store. All money ARITHMETIC and comparisons are
// done by PostgreSQL on NUMERIC, never with JS floating point.
types.setTypeParser(20, (value) => parseInt(value, 10));
types.setTypeParser(1700, (value) => parseFloat(value));

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolSize,
});

// An idle client erroring (e.g. DB restarted) must not crash the process.
pool.on('error', (err) => logger.error('Unexpected error on idle database client', err.message));

async function run(fn, beginSql) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query(beginSql);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      broken = true; // connection is unusable; make the pool discard it
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

/**
 * Runs `fn(client)` inside ONE database transaction.
 * Commits if it resolves, rolls back if it throws => all-or-nothing (atomicity).
 */
function withTransaction(fn) {
  return run(fn, 'BEGIN');
}

/**
 * Runs read-only queries against a single consistent snapshot, so e.g. a page of rows and
 * the total count always agree with each other.
 */
function withSnapshot(fn) {
  return run(fn, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
}

module.exports = { pool, withTransaction, withSnapshot };
