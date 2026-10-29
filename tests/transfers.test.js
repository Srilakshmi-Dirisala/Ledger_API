const {
  api,
  pool,
  setupDb,
  resetDb,
  closeDb,
  createAccount,
  credit,
  getBalance,
  ledgerBalance,
  countRows,
  nextRef,
} = require('./helpers');
const transactionRepository = require('../src/repositories/transactionRepository');

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closeDb);
afterEach(() => jest.restoreAllMocks());

const transfer = (body) => api().post('/transfers').send({ reference_id: nextRef('t'), ...body });

async function twoAccounts(balanceA = 100, balanceB = 50) {
  const a = await createAccount('A');
  const b = await createAccount('B');
  if (balanceA) await credit(a.id, balanceA);
  if (balanceB) await credit(b.id, balanceB);
  return { a, b };
}

describe('POST /transfers - success', () => {
  test('the example from the assessment: A=100, B=50, transfer 30 -> A=70, B=80', async () => {
    const { a, b } = await twoAccounts(100, 50);

    const res = await transfer({
      from_account_id: a.id,
      to_account_id: b.id,
      amount: 30,
      description: 'Rent share',
      reference_id: 'tr-1',
    });

    expect(res.status).toBe(201);
    expect(res.body.accounts).toEqual({
      from: { id: a.id, balance: 70 },
      to: { id: b.id, balance: 80 },
    });
    expect(await getBalance(a.id)).toBe(70);
    expect(await getBalance(b.id)).toBe(80);
  });

  test('creates a transfer record plus a linked debit and credit transaction', async () => {
    const { a, b } = await twoAccounts();
    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 30, reference_id: 'tr-2' });

    const { data } = res.body;
    expect(data).toMatchObject({
      from_account_id: a.id,
      to_account_id: b.id,
      amount: 30,
      reference_id: 'tr-2',
    });
    expect(data.debit_transaction).toMatchObject({
      account_id: a.id,
      type: 'debit',
      amount: 30,
      transfer_id: data.id,
      reference_id: 'tr-2',
    });
    expect(data.credit_transaction).toMatchObject({
      account_id: b.id,
      type: 'credit',
      amount: 30,
      transfer_id: data.id,
      reference_id: 'tr-2',
    });

    const history = await api().get(`/accounts/${a.id}/transactions`);
    expect(history.body.data[0].id).toBe(data.debit_transaction.id); // newest first
  });

  test('transferring the entire balance is allowed', async () => {
    const { a, b } = await twoAccounts(100, 0);
    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 100 });

    expect(res.status).toBe(201);
    expect(await getBalance(a.id)).toBe(0);
    expect(await getBalance(b.id)).toBe(100);
  });

  test('ledger totals still match balances afterwards', async () => {
    const { a, b } = await twoAccounts(100, 50);
    await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 33.33 });

    expect(await ledgerBalance(a.id)).toBe(await getBalance(a.id));
    expect(await ledgerBalance(b.id)).toBe(await getBalance(b.id));
  });
});

describe('POST /transfers - failures change nothing', () => {
  async function expectUntouched(a, b, balA, balB, txCount) {
    expect(await getBalance(a.id)).toBe(balA);
    expect(await getBalance(b.id)).toBe(balB);
    expect(await countRows('transfers')).toBe(0);
    expect(await countRows('transactions')).toBe(txCount);
  }

  test('insufficient balance -> 422', async () => {
    const { a, b } = await twoAccounts(100, 50);
    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 100.01 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_BALANCE');
    await expectUntouched(a, b, 100, 50, 2);
  });

  test('unknown source account -> 404', async () => {
    const { b } = await twoAccounts(0, 50);
    const res = await transfer({ from_account_id: 9999, to_account_id: b.id, amount: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(res.body.error.details[0].value).toBe(9999);
    expect(await getBalance(b.id)).toBe(50);
  });

  test('unknown destination account -> 404 and the source is NOT debited', async () => {
    const { a } = await twoAccounts(100, 0);
    const res = await transfer({ from_account_id: a.id, to_account_id: 9999, amount: 10 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(res.body.error.details[0].value).toBe(9999);
    expect(await getBalance(a.id)).toBe(100);
    expect(await countRows('transactions')).toBe(1);
  });

  test('same source and destination -> 400', async () => {
    const { a } = await twoAccounts(100, 0);
    const res = await transfer({ from_account_id: a.id, to_account_id: a.id, amount: 10 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'to_account_id' });
    expect(await getBalance(a.id)).toBe(100);
  });

  test.each([
    ['zero amount', { amount: 0 }, 'amount'],
    ['negative amount', { amount: -1 }, 'amount'],
    ['string amount', { amount: '5' }, 'amount'],
    ['3 decimals', { amount: 1.234 }, 'amount'],
    ['missing amount', { amount: undefined }, 'amount'],
    ['missing reference_id', { reference_id: undefined }, 'reference_id'],
    ['blank reference_id', { reference_id: ' ' }, 'reference_id'],
    ['non-integer account id', { from_account_id: 1.5 }, 'from_account_id'],
    ['string account id', { to_account_id: 'abc' }, 'to_account_id'],
    ['missing from_account_id', { from_account_id: undefined }, 'from_account_id'],
  ])('%s -> 400', async (_label, override, field) => {
    const { a, b } = await twoAccounts(100, 50);
    const res = await api()
      .post('/transfers')
      .send({ from_account_id: a.id, to_account_id: b.id, amount: 10, reference_id: 'x-1', ...override });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.field)).toContain(field);
    await expectUntouched(a, b, 100, 50, 2);
  });

  test('duplicate reference_id -> 409, and the money moves only once', async () => {
    const { a, b } = await twoAccounts(100, 50);
    const first = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 30, reference_id: 'dup' });
    const second = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 30, reference_id: 'dup' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('DUPLICATE_TRANSACTION');
    expect(await getBalance(a.id)).toBe(70);
    expect(await getBalance(b.id)).toBe(80);
    expect(await countRows('transfers')).toBe(1);
  });

  test('reference_id already used on the destination account -> 409, nothing moves', async () => {
    const { a, b } = await twoAccounts(100, 0);
    await credit(b.id, 5, { reference_id: 'taken' });

    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 10, reference_id: 'taken' });

    expect(res.status).toBe(409);
    expect(await getBalance(a.id)).toBe(100);
    expect(await getBalance(b.id)).toBe(5);
    expect(await countRows('transfers')).toBe(0);
  });

  test('ATOMICITY: a failure in the middle of a transfer rolls EVERYTHING back', async () => {
    const { a, b } = await twoAccounts(100, 50);

    // Let the debit-leg insert succeed, then crash on the credit-leg insert. By then the source
    // was already debited, the destination credited and the transfer row written.
    const original = transactionRepository.insert;
    jest
      .spyOn(transactionRepository, 'insert')
      .mockImplementationOnce((...args) => original(...args))
      .mockRejectedValueOnce(new Error('simulated crash'));

    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 30 });

    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    await expectUntouched(a, b, 100, 50, 2);
    expect(await ledgerBalance(a.id)).toBe(100);
    expect(await ledgerBalance(b.id)).toBe(50);
  });

  test('ATOMICITY: a credit that overflows the destination rolls the debit back', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    await credit(a.id, 10);
    await credit(b.id, 999999999999.99);

    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 5 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_OUT_OF_RANGE');
    expect(await getBalance(a.id)).toBe(10); // debit leg was rolled back
    expect(await getBalance(b.id)).toBe(999999999999.99);
    expect(await countRows('transfers')).toBe(0);
  });
});

describe('POST /transfers - transfers are immutable too', () => {
  test('DATABASE: transfers rows cannot be updated or deleted', async () => {
    const { a, b } = await twoAccounts();
    const res = await transfer({ from_account_id: a.id, to_account_id: b.id, amount: 1 });
    const id = res.body.data.id;

    await expect(pool.query('UPDATE transfers SET amount = 99 WHERE id = $1', [id])).rejects.toThrow(/immutable/);
    await expect(pool.query('DELETE FROM transfers WHERE id = $1', [id])).rejects.toThrow(/immutable/);
  });

  test('only POST is allowed on /transfers', async () => {
    const res = await api().get('/transfers');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});

describe('POST /transfers - concurrency', () => {
  test('opposite transfers at the same time never deadlock and conserve the total', async () => {
    const { a, b } = await twoAccounts(100, 100);

    const jobs = [];
    for (let i = 0; i < 10; i += 1) {
      jobs.push(transfer({ from_account_id: a.id, to_account_id: b.id, amount: 5, reference_id: `ab-${i}` }));
      jobs.push(transfer({ from_account_id: b.id, to_account_id: a.id, amount: 5, reference_id: `ba-${i}` }));
    }
    const results = await Promise.all(jobs);

    expect(results.every((r) => r.status === 201)).toBe(true);
    const balA = await getBalance(a.id);
    const balB = await getBalance(b.id);
    expect(balA + balB).toBe(200);
    expect(balA).toBe(100); // 10 x 5 out, 10 x 5 in
    expect(await ledgerBalance(a.id)).toBe(balA);
    expect(await ledgerBalance(b.id)).toBe(balB);
  });

  test('parallel transfers out of one account can never overdraw it', async () => {
    const a = await createAccount('A');
    const b = await createAccount('B');
    await credit(a.id, 100);

    const results = await Promise.all(
      Array.from({ length: 15 }, (_, i) =>
        transfer({ from_account_id: a.id, to_account_id: b.id, amount: 10, reference_id: `p-${i}` })
      )
    );
    const ok = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 422).length;

    expect(ok).toBe(10);
    expect(rejected).toBe(5);
    expect(await getBalance(a.id)).toBe(0);
    expect(await getBalance(b.id)).toBe(100);
  });
});
