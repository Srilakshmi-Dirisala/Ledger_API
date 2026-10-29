const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

/** Rejects request bodies that are not JSON (bodyless requests pass through to validation). */
function requireJson(req, res, next) {
  // Some clients send "Content-Length: 0" for an empty POST; that is "no body", not a bad type.
  const hasBody =
    Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'] !== undefined;
  if (hasBody && !req.is('application/json')) {
    return next(
      new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
    );
  }
  return next();
}

/** 405 + Allow header for a method a resource does not support. */
const methodNotAllowed = (allowed) => (req, res, next) => {
  const headers = { Allow: allowed.join(', ') };
  if (req.method === 'OPTIONS') {
    res.set(headers);
    return res.status(204).end();
  }
  return next(
    new AppError(
      405,
      'METHOD_NOT_ALLOWED',
      `${req.method} is not allowed on this resource. Allowed: ${headers.Allow}`,
      [],
      headers
    )
  );
};

/** Transactions are immutable: anything other than reading one is refused with a clear reason. */
const transactionImmutable = (req, res, next) => {
  const headers = { Allow: 'GET, HEAD' };
  if (req.method === 'OPTIONS') {
    res.set(headers);
    return res.status(204).end();
  }
  return next(
    new AppError(
      405,
      'TRANSACTION_IMMUTABLE',
      'Transactions are immutable: they cannot be modified or deleted',
      [],
      headers
    )
  );
};

function notFound(req, res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

function requestLogger(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms.toFixed(1)}ms)`);
  });
  next();
}

module.exports = { requireJson, methodNotAllowed, transactionImmutable, notFound, requestLogger };
