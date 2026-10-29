const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

function send(res, status, code, message, details = [], headers = {}) {
  res.set(headers);
  return res.status(status).json({ error: { code, message, details } });
}

/**
 * Single place that turns ANY error into the consistent error shape:
 *   { "error": { "code", "message", "details": [] } }
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Errors we raise on purpose.
  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.details, err.headers);
  }

  // Malformed / oversized JSON from express.json()
  if (err.type === 'entity.parse.failed') {
    return send(res, 400, 'INVALID_REQUEST_BODY', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (err.type === 'charset.unsupported' || err.type === 'encoding.unsupported') {
    return send(res, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Unsupported charset or encoding');
  }

  // PostgreSQL errors that slipped past application checks (the DB is the last line of defence).
  switch (err.code) {
    case '23505': // unique_violation
      return send(res, 409, 'DUPLICATE_TRANSACTION', 'A record with the same unique value already exists', [
        { constraint: err.constraint },
      ]);
    case '23503': // foreign_key_violation
      return send(res, 404, 'ACCOUNT_NOT_FOUND', 'Referenced account does not exist');
    case '23514': // check_violation
      if (err.constraint === 'accounts_balance_non_negative') {
        return send(res, 422, 'INSUFFICIENT_BALANCE', 'Operation would make the account balance negative');
      }
      return send(res, 400, 'CONSTRAINT_VIOLATION', 'Data violates a database constraint', [
        { constraint: err.constraint },
      ]);
    case '22003': // numeric_value_out_of_range
      return send(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Resulting balance exceeds the supported maximum');
    case 'ECONNREFUSED':
    case '57P01': // admin_shutdown
    case '57P03': // cannot_connect_now
      return send(res, 503, 'DATABASE_UNAVAILABLE', 'The database is currently unavailable');
    default:
      break;
  }

  logger.error(`Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  return send(res, 500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

module.exports = errorHandler;
