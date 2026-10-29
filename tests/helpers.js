const request = require('supertest');
const { createApp } = require('../src/app');
const { pool } = require('../src/config/db');
const { migrate } = require('../src/db/migrate');

const app = createApp();
const api = () => request(app);

const setupDb = () => migrate(pool);
const resetDb = () =>
  pool.query('TRUNCATE transactions, transfers, accounts RESTART IDENTITY CASCADE');
const closeDb = () => pool.end();

async function createAccount(name = 'Test account') {
  const res = await api().post('/accounts').send({ name });
  if (res.status !== 201) throw new Error(`createAccount failed: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

let refCounter = 0;
const nextRef = (prefix = 'ref') => `${prefix}-${++refCounter}`;

/** POST /accounts/:id/transactions with a unique reference_id unless one is given. */
const postTransaction = (accountId, body) =>
  api()
    .post(`/accounts/${accountId}/transactions`)
    .send({ reference_id: nextRef(), ...body });

const credit = (accountId, amount, extra = {}) =>
  postTransaction(accountId, { type: 'credit', amount, ...extra });
const debit = (accountId, amount, extra = {}) =>
  postTransaction(accountId, { type: 'debit', amount, ...extra });

async function getBalance(accountId) {
  const res = await api().get(`/accounts/${accountId}`);
  return res.body.data.balance;
}

/** SUM(credits) - SUM(debits) straight from the ledger table. */
async function ledgerBalance(accountId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS balance
       FROM transactions WHERE account_id = $1`,
    [accountId]
  );
  return rows[0].balance;
}

async function countRows(table) {
  const { rows } = await pool.query(`SELECT count(*) AS n FROM ${table}`);
  return rows[0].n;
}

module.exports = {
  api,
  pool,
  setupDb,
  resetDb,
  closeDb,
  createAccount,
  nextRef,
  postTransaction,
  credit,
  debit,
  getBalance,
  ledgerBalance,
  countRows,
};
