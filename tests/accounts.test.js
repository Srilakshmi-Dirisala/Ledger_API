const { api, setupDb, resetDb, closeDb, createAccount } = require('./helpers');

beforeAll(setupDb);
beforeEach(resetDb);
afterAll(closeDb);

describe('POST /accounts', () => {
  test('creates an account with an initial balance of 0', async () => {
    const res = await api().post('/accounts').send({ name: 'Savings' });

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/accounts/${res.body.data.id}`);
    expect(res.body.data).toMatchObject({ name: 'Savings', balance: 0 });
    expect(typeof res.body.data.id).toBe('number');
    expect(new Date(res.body.data.created_at).toString()).not.toBe('Invalid Date');
  });

  test('trims the name', async () => {
    const res = await api().post('/accounts').send({ name: '  Padded  ' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Padded');
  });

  test.each([
    ['missing', {}, 'MISSING_FIELD'],
    ['empty', { name: '' }, 'INVALID_NAME'],
    ['blank', { name: '   ' }, 'INVALID_NAME'],
    ['not a string', { name: 123 }, 'INVALID_NAME'],
    ['null', { name: null }, 'INVALID_NAME'],
    ['too long', { name: 'x'.repeat(101) }, 'INVALID_NAME'],
  ])('rejects a %s name', async (_label, body, detailCode) => {
    const res = await api().post('/accounts').send(body);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ field: 'name', code: detailCode }),
    ]);
  });

  test('rejects unknown fields, so a client cannot set the balance', async () => {
    const res = await api().post('/accounts').send({ name: 'Sneaky', balance: 1000000 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'balance', code: 'UNKNOWN_FIELD' });
  });

  test('rejects malformed JSON', async () => {
    const res = await api()
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REQUEST_BODY');
  });

  test('rejects a JSON body that is not an object', async () => {
    const res = await api().post('/accounts').send([1, 2, 3]);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ field: 'body', code: 'INVALID_BODY' });
  });

  test('rejects a non-JSON content type', async () => {
    const res = await api().post('/accounts').set('Content-Type', 'text/plain').send('name=x');

    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  test('does not create anything when validation fails', async () => {
    await api().post('/accounts').send({ name: '' });
    const list = await api().get('/accounts');
    expect(list.body.pagination.total_records).toBe(0);
  });
});

describe('GET /accounts/:accountId', () => {
  test('returns the account', async () => {
    const account = await createAccount('Checking');
    const res = await api().get(`/accounts/${account.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: account.id, name: 'Checking', balance: 0 });
  });

  test('returns 404 for an account that does not exist', async () => {
    const res = await api().get('/accounts/999999');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(res.body.error.details).toEqual(expect.any(Array));
  });

  test.each(['abc', '0', '-1', '1.5', '1e3', '9999999999999999999999'])(
    'returns 400 for the invalid id "%s"',
    async (id) => {
      const res = await api().get(`/accounts/${id}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_ACCOUNT_ID');
    }
  );

  test('refuses methods that are not supported', async () => {
    const account = await createAccount();
    const res = await api().delete(`/accounts/${account.id}`);

    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET');
    expect(res.body.error.code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('GET /accounts (list)', () => {
  test('paginates, newest account first', async () => {
    for (let i = 1; i <= 5; i += 1) await createAccount(`Account ${i}`);

    const res = await api().get('/accounts?page=2&limit=2');

    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({
      current_page: 2,
      page_size: 2,
      total_records: 5,
      total_pages: 3,
    });
    expect(res.body.data.map((a) => a.name)).toEqual(['Account 3', 'Account 2']);
  });
});

describe('unknown routes and health', () => {
  test('GET /health', async () => {
    const res = await api().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('unknown route returns a JSON 404 in the standard error shape', async () => {
    const res = await api().get('/nope');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'ROUTE_NOT_FOUND', details: [] });
  });
});
