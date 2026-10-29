// The API validates input, but the DATABASE is the last line of defence. These tests talk to
// PostgreSQL directly (bypassing the API) to prove the constraints hold on their own.
const { pool, setupDb, resetDb, closeDb, createAccount } = require('./helpers');

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closeDb);

const insertTx = (accountId, overrides = {}) => {
  const v = { type: 'credit', amount: 10, reference_id: 'r-1', ...overrides };
  return pool.query(
    'INSERT INTO transactions (account_id, type, amount, reference_id) VALUES ($1, $2, $3, $4)',
    [accountId, v.type, v.amount, v.reference_id]
  );
};

test('migrations are idempotent (running twice applies nothing the second time)', async () => {
  const { migrate } = require('../src/db/migrate');
  expect(await migrate(pool)).toEqual([]);
});

test('balance can never be negative', async () => {
  const account = await createAccount();
  await expect(
    pool.query('UPDATE accounts SET balance = -0.01 WHERE id = $1', [account.id])
  ).rejects.toMatchObject({ code: '23514', constraint: 'accounts_balance_non_negative' });
});

test('account name cannot be blank', async () => {
  await expect(pool.query("INSERT INTO accounts (name) VALUES ('   ')")).rejects.toMatchObject({
    code: '23514',
  });
});

test('transaction type must be credit or debit', async () => {
  const account = await createAccount();
  await expect(insertTx(account.id, { type: 'refund' })).rejects.toMatchObject({ code: '23514' });
});

test.each([0, -1])('transaction amount must be > 0 (got %s)', async (amount) => {
  const account = await createAccount();
  await expect(insertTx(account.id, { amount })).rejects.toMatchObject({ code: '23514' });
});

test('transaction reference_id cannot be blank', async () => {
  const account = await createAccount();
  await expect(insertTx(account.id, { reference_id: '  ' })).rejects.toMatchObject({ code: '23514' });
});

test('a transaction must belong to an existing account (foreign key)', async () => {
  await expect(insertTx(777)).rejects.toMatchObject({ code: '23503' });
});

test('(account_id, reference_id) is unique', async () => {
  const account = await createAccount();
  await insertTx(account.id);
  await expect(insertTx(account.id)).rejects.toMatchObject({
    code: '23505',
    constraint: 'transactions_account_reference_unique',
  });
});

test('an account that has transactions cannot be deleted', async () => {
  const account = await createAccount();
  await insertTx(account.id);
  await expect(pool.query('DELETE FROM accounts WHERE id = $1', [account.id])).rejects.toMatchObject({
    code: '23503',
  });
});
