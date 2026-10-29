// Runs before every test file (jest "setupFiles").
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ledger_test';

// The tests TRUNCATE tables, so never let them run against a real database by accident.
const dbName = new URL(process.env.DATABASE_URL).pathname.replace(/^\//, '');
if (!dbName.endsWith('_test')) {
  throw new Error(
    `Refusing to run tests: database "${dbName}" does not end with "_test". ` +
      'Set TEST_DATABASE_URL to a dedicated test database.'
  );
}
