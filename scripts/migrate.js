const { pool } = require('../src/config/db');
const { migrate } = require('../src/db/migrate');

(async () => {
  try {
    const applied = await migrate(pool);
    if (applied.length === 0) {
      console.log('Database is up to date. No migrations to apply.');
    } else {
      applied.forEach((file) => console.log(`Applied migration: ${file}`));
    }
  } catch (err) {
    console.error(err.message);
    if (err.code === 'ECONNREFUSED') {
      console.error('Could not reach PostgreSQL. Is it running? Check DATABASE_URL in your .env file.');
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
