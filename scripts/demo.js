// Walks through the assessment scenarios against a RUNNING server and prints each result.
//   1) npm start      (in another terminal)
//   2) npm run demo
// Needs Node 18+ (built-in fetch). Override the target with BASE_URL=http://host:port.
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const run = Date.now().toString(36); // keeps reference_ids unique across repeated demo runs

async function call(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

function show(title, { status, body }) {
  console.log(`\n--- ${title}`);
  console.log(`HTTP ${status}`);
  console.log(JSON.stringify(body, null, 2));
}

async function main() {
  const health = await call('GET', '/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`Server is not reachable at ${BASE_URL}. Start it first with: npm start`);
    process.exit(1);
  }

  console.log('=== 1. Balance example: +100, +50, -30, -20  =>  100');
  const created = await call('POST', '/accounts', { name: `Demo account ${run}` });
  show('create account', created);
  const id = created.body.data.id;

  const steps = [
    ['credit', 100],
    ['credit', 50],
    ['debit', 30],
    ['debit', 20],
  ];
  for (const [type, amount] of steps) {
    const res = await call('POST', `/accounts/${id}/transactions`, {
      type,
      amount,
      description: `${type} ${amount}`,
      reference_id: `demo-${run}-${type}-${amount}`,
    });
    console.log(`${type.padEnd(6)} ${String(amount).padStart(4)} -> HTTP ${res.status}, balance ${res.body.account.balance}`);
  }
  show('account after the four transactions (expect balance 100)', await call('GET', `/accounts/${id}`));

  console.log('\n=== 2. Rejected requests never change the balance');
  show(
    'debit 1000 (insufficient balance)',
    await call('POST', `/accounts/${id}/transactions`, { type: 'debit', amount: 1000, reference_id: `demo-${run}-big` })
  );
  show(
    'duplicate reference_id',
    await call('POST', `/accounts/${id}/transactions`, { type: 'credit', amount: 100, reference_id: `demo-${run}-credit-100` })
  );
  show(
    'invalid type and amount',
    await call('POST', `/accounts/${id}/transactions`, { type: 'refund', amount: -5, reference_id: `demo-${run}-bad` })
  );
  show('account is still 100', await call('GET', `/accounts/${id}`));

  console.log('\n=== 3. Pagination (latest first)');
  show('page 1, limit 2', await call('GET', `/accounts/${id}/transactions?page=1&limit=2`));
  show('invalid pagination', await call('GET', `/accounts/${id}/transactions?page=0&limit=500`));

  console.log('\n=== 4. Transactions are immutable');
  const list = await call('GET', `/accounts/${id}/transactions?limit=1`);
  const txId = list.body.data[0].id;
  show('PUT a transaction', await call('PUT', `/accounts/${id}/transactions/${txId}`, { amount: 1 }));
  show('DELETE a transaction', await call('DELETE', `/accounts/${id}/transactions/${txId}`));

  console.log('\n=== 5. Bonus: transfer 30 from A (100) to B (50)  =>  A=70, B=80');
  const a = (await call('POST', '/accounts', { name: `Transfer A ${run}` })).body.data;
  const b = (await call('POST', '/accounts', { name: `Transfer B ${run}` })).body.data;
  await call('POST', `/accounts/${a.id}/transactions`, { type: 'credit', amount: 100, reference_id: `seed-a-${run}` });
  await call('POST', `/accounts/${b.id}/transactions`, { type: 'credit', amount: 50, reference_id: `seed-b-${run}` });
  show(
    'transfer 30 A -> B',
    await call('POST', '/transfers', {
      from_account_id: a.id,
      to_account_id: b.id,
      amount: 30,
      description: 'Demo transfer',
      reference_id: `demo-transfer-${run}`,
    })
  );
  show(
    'transfer 500 A -> B (insufficient)',
    await call('POST', '/transfers', { from_account_id: a.id, to_account_id: b.id, amount: 500, reference_id: `demo-big-${run}` })
  );
  show(
    'transfer to a missing account',
    await call('POST', '/transfers', { from_account_id: a.id, to_account_id: 999999, amount: 1, reference_id: `demo-missing-${run}` })
  );
  console.log(`\nFinal balances: A=${(await call('GET', `/accounts/${a.id}`)).body.data.balance}, B=${(await call('GET', `/accounts/${b.id}`)).body.data.balance}`);
  console.log('\nDemo finished. Run `npm run reconcile` to verify every balance against its ledger.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
