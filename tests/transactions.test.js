const {
  api,
  pool,
  setupDb,
  resetDb,
  closeDb,
  createAccount,
  postTransaction,
  credit,
  debit,
  getBalance,
  ledgerBalance,
  countRows,
} = require('./helpers');
const transactionRepository = require('../src/repositories/transactionRepository');

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closeDb);
afterEach(() => jest.restoreAllMocks());

describe('balance consistency', () => {
  test('the example from the assessment ends at 100', async () => {
    const account = await createAccount();

    const steps = [
      [credit, 100, 100],
      [credit, 50, 150],
      [debit, 30, 120],
      [debit, 20, 100],
    ];
    for (const [fn, amount, expectedBalance] of steps) {
      const res = await fn(account.id, amount);
      expect(res.status).toBe(201);
      expect(res.body.account).toEqual({ id: account.id, balance: expectedBalance });
    }

    expect(await getBalance(account.id)).toBe(100);
    expect(await ledgerBalance(account.id)).toBe(100);
  });

  test('response contains the created transaction', async () => {
    const account = await createAccount();
    const res = await credit(account.id, 12.5, { description: 'Salary', reference_id: 'pay-1' });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/accounts/${account.id}/transactions/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({
      account_id: account.id,
      transfer_id: null,
      type: 'credit',
      amount: 12.5,
      description: 'Salary',
      reference_id: 'pay-1',
    });
    expect(res.body.data.created_at).toEqual(expect.any(String));
  });

  test('decimal amounts add up exactly (0.1 + 0.2 = 0.3)', async () => {
    const account = await createAccount();
    await credit(account.id, 0.1);
    await credit(account.id, 0.2);

    expect(await getBalance(account.id)).toBe(0.3);
    const exact = await pool.query("SELECT balance = 0.30 AS ok FROM accounts WHERE id = $1", [account.id]);
    expect(exact.rows[0].ok).toBe(true);
  });

  test('a debit of exactly the full balance is allowed', async () => {
    const account = await createAccount();
    await credit(account.id, 75.25);
    const res = await debit(account.id, 75.25);

    expect(res.status).toBe(201);
    expect(await getBalance(account.id)).toBe(0);
  });

  test('description is optional and stored as null', async () => {
    const account = await createAccount();
    const res = await credit(account.id, 5);
    expect(res.body.data.description).toBeNull();
  });
});

describe('rejected transactions never touch the balance', () => {
  test('insufficient balance -> 422, balance and ledger unchanged', async () => {
    const account = await createAccount();
    await credit(account.id, 100);

    const res = await debit(account.id, 100.01);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(res.body.error.details[0]).toMatchObject({
      account_id: account.id,
      available_balance: 100,
      requested_amount: 100.01,
    });
    expect(await getBalance(account.id)).toBe(100);
    expect(await countRows('transactions')).toBe(1);
  });

  test('debit on an empty account is rejected', async () => {
    const account = await createAccount();
    const res = await debit(account.id, 1);

    expect(res.status).toBe(422);
    expect(await getBalance(account.id)).toBe(0);
    expect(await countRows('transactions')).toBe(0);
  });

  test('a credit that would overflow the balance is rejected and rolled back', async () => {
    const account = await createAccount();
    await credit(account.id, 999999999999.99);

    const res = await credit(account.id, 1);

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(await getBalance(account.id)).toBe(999999999999.99);
    expect(await countRows('transactions')).toBe(1);
  });

  test('if saving the ledger row fails AFTER the balance was updated, everything is rolled back', async () => {
    const account = await createAccount();
    await credit(account.id, 100);

    jest.spyOn(transactionRepository, 'insert').mockRejectedValueOnce(new Error('simulated crash'));
    const res = await credit(account.id, 50);

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/simulated crash/); // internals are not leaked
    expect(await getBalance(account.id)).toBe(100); // the +50 was rolled back
    expect(await countRows('transactions')).toBe(1);
    expect(await ledgerBalance(account.id)).toBe(100);
  });
});

describe('validation', () => {
  let account;
  beforeEach(async () => {
    account = await createAccount();
  });

  test.each([
    ['missing', undefined, 'MISSING_FIELD'],
    ['unknown value', 'refund', 'INVALID_TRANSACTION_TYPE'],
    ['upper case', 'CREDIT', 'INVALID_TRANSACTION_TYPE'],
    ['a number', 1, 'INVALID_TRANSACTION_TYPE'],
    ['null', null, 'INVALID_TRANSACTION_TYPE'],
  ])('type %s -> 400', async (_label, type, detailCode) => {
    const res = await postTransaction(account.id, { type, amount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'type', code: detailCode }),
    ]);
  });

  test.each([
    ['missing', undefined, 'MISSING_FIELD'],
    ['zero', 0, 'INVALID_AMOUNT'],
    ['negative', -5, 'INVALID_AMOUNT'],
    ['a numeric string', '10', 'INVALID_AMOUNT'],
    ['text', 'abc', 'INVALID_AMOUNT'],
    ['null', null, 'INVALID_AMOUNT'],
    ['3 decimal places', 1.005, 'INVALID_AMOUNT'],
    ['float noise', 0.1 + 0.2, 'INVALID_AMOUNT'],
    ['too large', 1000000000000, 'INVALID_AMOUNT'],
    ['infinite (1e999)', 'RAW:1e999', 'INVALID_AMOUNT'],
  ])('amount %s -> 400', async (_label, amount, detailCode) => {
    let res;
    if (typeof amount === 'string' && amount.startsWith('RAW:')) {
      // JSON.stringify cannot produce Infinity, so send raw JSON text.
      res = await api()
        .post(`/accounts/${account.id}/transactions`)
        .set('Content-Type', 'application/json')
        .send(`{"type":"credit","amount":${amount.slice(4)},"reference_id":"raw-1"}`);
    } else {
      res = await postTransaction(account.id, { type: 'credit', amount });
    }

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'amount', code: detailCode }),
    ]);
    expect(await countRows('transactions')).toBe(0);
  });

  test.each([
    ['missing', undefined, 'MISSING_FIELD'],
    ['empty', '', 'INVALID_REFERENCE_ID'],
    ['blank', '   ', 'INVALID_REFERENCE_ID'],
    ['a number', 42, 'INVALID_REFERENCE_ID'],
    ['too long', 'r'.repeat(101), 'INVALID_REFERENCE_ID'],
  ])('reference_id %s -> 400', async (_label, reference_id, detailCode) => {
    const res = await api()
      .post(`/accounts/${account.id}/transactions`)
      .send({ type: 'credit', amount: 10, reference_id });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'reference_id', code: detailCode }),
    ]);
  });

  test('several problems are all reported at once', async () => {
    const res = await api()
      .post(`/accounts/${account.id}/transactions`)
      .send({ type: 'nope', amount: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual([
      'amount',
      'reference_id',
      'type',
    ]);
  });

  test('unknown fields are rejected (e.g. a client-supplied created_at)', async () => {
    const res = await postTransaction(account.id, {
      type: 'credit',
      amount: 10,
      created_at: '2000-01-01T00:00:00Z',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'created_at', code: 'UNKNOWN_FIELD' });
  });

  test('an empty body is a validation error', async () => {
    const res = await api().post(`/accounts/${account.id}/transactions`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('unknown account -> 404', async () => {
    const res = await credit(424242, 10);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  test.each(['abc', '0', '-3'])('invalid account id "%s" -> 400', async (id) => {
    const res = await credit(id, 10);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_ACCOUNT_ID');
  });
});

describe('duplicate reference_id', () => {
  test('second use on the same account -> 409 and the balance changes only once', async () => {
    const account = await createAccount();
    const first = await credit(account.id, 40, { reference_id: 'order-1' });
    const second = await credit(account.id, 40, { reference_id: 'order-1' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(second.body.error.details[0]).toMatchObject({
      reference_id: 'order-1',
      existing_transaction_id: first.body.data.id,
    });
    expect(await getBalance(account.id)).toBe(40);
    expect(await countRows('transactions')).toBe(1);
  });

  test('retrying a successful debit reports "duplicate", not "insufficient balance"', async () => {
    const account = await createAccount();
    await credit(account.id, 50);
    await debit(account.id, 50, { reference_id: 'pay-1' });

    const retry = await debit(account.id, 50, { reference_id: 'pay-1' });

    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('DUPLICATE_TRANSACTION');
  });

  test('the same reference_id on a DIFFERENT account is fine', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');

    expect((await credit(a.id, 10, { reference_id: 'shared' })).status).toBe(201);
    expect((await credit(b.id, 10, { reference_id: 'shared' })).status).toBe(201);
  });

  test('a credit and a debit cannot reuse one reference_id either', async () => {
    const account = await createAccount();
    await credit(account.id, 100, { reference_id: 'same' });
    const res = await debit(account.id, 10, { reference_id: 'same' });

    expect(res.status).toBe(409);
  });
});

describe('GET /accounts/:id/transactions (pagination + sorting)', () => {
  async function seed(count) {
    const account = await createAccount();
    for (let i = 1; i <= count; i += 1) {
      await credit(account.id, i, { reference_id: `seed-${i}`, description: `tx ${i}` });
    }
    return account;
  }

  test('returns latest first, with pagination metadata', async () => {
    const account = await seed(5);
    const res = await api().get(`/accounts/${account.id}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t) => t.reference_id)).toEqual([
      'seed-5',
      'seed-4',
      'seed-3',
      'seed-2',
      'seed-1',
    ]);
    expect(res.body.pagination).toEqual({
      current_page: 1,
      page_size: 10,
      total_records: 5,
      total_pages: 1,
    });

    const times = res.body.data.map((t) => new Date(t.created_at).getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times); // non-increasing
  });

  test('page and limit slice the result', async () => {
    const account = await seed(5);

    const page1 = await api().get(`/accounts/${account.id}/transactions?page=1&limit=2`);
    const page2 = await api().get(`/accounts/${account.id}/transactions?page=2&limit=2`);
    const page3 = await api().get(`/accounts/${account.id}/transactions?page=3&limit=2`);

    expect(page1.body.data.map((t) => t.reference_id)).toEqual(['seed-5', 'seed-4']);
    expect(page2.body.data.map((t) => t.reference_id)).toEqual(['seed-3', 'seed-2']);
    expect(page3.body.data.map((t) => t.reference_id)).toEqual(['seed-1']);
    expect(page2.body.pagination).toEqual({
      current_page: 2,
      page_size: 2,
      total_records: 5,
      total_pages: 3,
    });
  });

  test('a page past the end is an empty list with correct metadata', async () => {
    const account = await seed(3);
    const res = await api().get(`/accounts/${account.id}/transactions?page=9&limit=2`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({
      current_page: 9,
      page_size: 2,
      total_records: 3,
      total_pages: 2,
    });
  });

  test('an account with no transactions has total_pages 0', async () => {
    const account = await createAccount();
    const res = await api().get(`/accounts/${account.id}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination).toEqual({
      current_page: 1,
      page_size: 10,
      total_records: 0,
      total_pages: 0,
    });
  });

  test('only that account\'s transactions are returned', async () => {
    const a = await seed(2);
    const b = await createAccount('B');
    await credit(b.id, 999, { reference_id: 'other' });

    const res = await api().get(`/accounts/${a.id}/transactions`);
    expect(res.body.pagination.total_records).toBe(2);
    expect(res.body.data.every((t) => t.account_id === a.id)).toBe(true);
  });

  test.each([
    ['page=0'],
    ['page=-1'],
    ['page=abc'],
    ['page=1.5'],
    ['page='],
    ['page=1&page=2'],
    ['limit=0'],
    ['limit=-5'],
    ['limit=101'],
    ['limit=ten'],
    ['page=0&limit=0'],
  ])('invalid pagination "%s" -> 400', async (query) => {
    const account = await createAccount();
    const res = await api().get(`/accounts/${account.id}/transactions?${query}`);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAGINATION');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  test('limit of exactly 100 is accepted', async () => {
    const account = await createAccount();
    const res = await api().get(`/accounts/${account.id}/transactions?limit=100`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page_size).toBe(100);
  });

  test('unknown account -> 404', async () => {
    const res = await api().get('/accounts/12345/transactions');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('GET /accounts/:id/transactions/:transactionId', () => {
  test('returns one transaction', async () => {
    const account = await createAccount();
    const created = await credit(account.id, 9);
    const res = await api().get(`/accounts/${account.id}/transactions/${created.body.data.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(created.body.data);
  });

  test('404 when the transaction belongs to another account', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    const created = await credit(a.id, 9);

    const res = await api().get(`/accounts/${b.id}/transactions/${created.body.data.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TRANSACTION_NOT_FOUND');
  });
});

describe('immutability', () => {
  let account;
  let transaction;
  beforeEach(async () => {
    account = await createAccount();
    transaction = (await credit(account.id, 100, { description: 'original' })).body.data;
  });

  test.each(['put', 'patch', 'delete'])('API: %s on a transaction is refused with 405', async (method) => {
    const res = await api()
      [method](`/accounts/${account.id}/transactions/${transaction.id}`)
      .send({ amount: 1 });

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe('TRANSACTION_IMMUTABLE');
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  test('API: the collection cannot be deleted or replaced either', async () => {
    const del = await api().delete(`/accounts/${account.id}/transactions`);
    const put = await api().put(`/accounts/${account.id}/transactions`).send({});
    expect(del.status).toBe(405);
    expect(put.status).toBe(405);
  });

  test('nothing changed after the refused attempts', async () => {
    await api().put(`/accounts/${account.id}/transactions/${transaction.id}`).send({ amount: 1 });
    await api().delete(`/accounts/${account.id}/transactions/${transaction.id}`);

    const res = await api().get(`/accounts/${account.id}/transactions/${transaction.id}`);
    expect(res.body.data).toEqual(transaction);
    expect(await getBalance(account.id)).toBe(100);
  });

  test('DATABASE: UPDATE and DELETE on transactions are blocked by a trigger', async () => {
    await expect(
      pool.query('UPDATE transactions SET amount = 1 WHERE id = $1', [transaction.id])
    ).rejects.toThrow(/immutable/);
    await expect(
      pool.query('DELETE FROM transactions WHERE id = $1', [transaction.id])
    ).rejects.toThrow(/immutable/);

    const { rows } = await pool.query('SELECT amount FROM transactions WHERE id = $1', [transaction.id]);
    expect(rows[0].amount).toBe(100);
  });
});

describe('concurrency', () => {
  test('20 parallel debits of 10 on a balance of 100: exactly 10 succeed, balance ends at 0', async () => {
    const account = await createAccount();
    await credit(account.id, 100);

    const results = await Promise.all(Array.from({ length: 20 }, () => debit(account.id, 10)));
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 422)).toHaveLength(10);
    expect(await getBalance(account.id)).toBe(0);
    expect(await ledgerBalance(account.id)).toBe(0);
  });

  test('5 parallel requests with the SAME reference_id: one wins, four get 409', async () => {
    const account = await createAccount();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => credit(account.id, 25, { reference_id: 'race' }))
    );
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await getBalance(account.id)).toBe(25);
    expect(await countRows('transactions')).toBe(1);
  });

  test('mixed parallel credits and debits always end consistent with the ledger', async () => {
    const account = await createAccount();
    await credit(account.id, 500);

    const jobs = [];
    for (let i = 0; i < 15; i += 1) jobs.push(credit(account.id, 7.5));
    for (let i = 0; i < 15; i += 1) jobs.push(debit(account.id, 12.25));
    const results = await Promise.all(jobs);

    expect(results.every((r) => r.status === 201)).toBe(true);
    const expected = 500 + 15 * 7.5 - 15 * 12.25;
    expect(await getBalance(account.id)).toBe(expected);
    expect(await ledgerBalance(account.id)).toBe(expected);
  });
});
