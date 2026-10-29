const express = require('express');
const { pool } = require('./config/db');
const accountRoutes = require('./routes/accountRoutes');
const transferRoutes = require('./routes/transferRoutes');
const errorHandler = require('./middleware/errorHandler');
const { notFound, requestLogger } = require('./middleware/http');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', async (req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (err) {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/accounts', accountRoutes);
  app.use('/transfers', transferRoutes);

  app.use(notFound);
  app.use(errorHandler); // must be last

  return app;
}

module.exports = { createApp };
