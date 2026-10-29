const env = require('./config/env');
const { pool } = require('./config/db');
const { createApp } = require('./app');
const logger = require('./utils/logger');

function describeDatabase(url) {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`; // never print credentials
  } catch (_) {
    return '(invalid DATABASE_URL)';
  }
}

async function main() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    logger.error(
      `Cannot connect to PostgreSQL at ${describeDatabase(env.databaseUrl)}: ${err.message}`
    );
    logger.error('Is the database running (docker compose up -d) and is DATABASE_URL correct?');
    process.exit(1);
  }

  const { rows } = await pool.query(
    "SELECT to_regclass('public.accounts') IS NOT NULL AS ready"
  );
  if (!rows[0].ready) {
    logger.error('Database tables are missing. Run `npm run migrate` first.');
    process.exit(1);
  }

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info(`Ledger API listening on http://localhost:${env.port}`);
  });

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref(); // force-quit if connections hang
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
