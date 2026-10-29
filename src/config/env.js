require('dotenv').config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/ledger',
  dbPoolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
};

module.exports = env;
