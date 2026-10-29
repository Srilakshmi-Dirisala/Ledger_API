const { ValidationError } = require('../errors/AppError');

// Machine-readable code per field, used inside error `details`.
const FIELD_CODES = {
  name: 'INVALID_NAME',
  type: 'INVALID_TRANSACTION_TYPE',
  amount: 'INVALID_AMOUNT',
  reference_id: 'INVALID_REFERENCE_ID',
  description: 'INVALID_DESCRIPTION',
  from_account_id: 'INVALID_ACCOUNT_ID',
  to_account_id: 'INVALID_ACCOUNT_ID',
};

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_PAGE = 1000000;

/** Converts zod issues into our `details` array: one entry per field, first problem wins. */
function issuesToDetails(issues, body) {
  const isObject = body !== null && typeof body === 'object' && !Array.isArray(body);
  const details = [];
  const seen = new Set();
  const add = (entry) => {
    if (seen.has(entry.field)) return;
    seen.add(entry.field);
    details.push(entry);
  };

  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        add({ field: key, code: 'UNKNOWN_FIELD', message: `'${key}' is not an allowed field` });
      }
      continue;
    }

    const field = issue.path.join('.') || 'body';

    if (field === 'body') {
      add({ field, code: 'INVALID_BODY', message: 'Request body must be a JSON object' });
    } else if (isObject && issue.path.length === 1 && body[issue.path[0]] === undefined) {
      // The key is absent (or undefined). Zod reports this as invalid_type for numbers/strings
      // but as invalid_value for enums, so do not rely on the issue code.
      add({ field, code: 'MISSING_FIELD', message: `${field} is required` });
    } else {
      add({ field, code: FIELD_CODES[field] || 'INVALID_VALUE', message: issue.message });
    }
  }
  return details;
}

/** Validates `body` against a zod schema; returns the cleaned data or throws ValidationError. */
function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(issuesToDetails(result.error.issues, body));
  }
  return result.data;
}

/** Path ids such as /accounts/:accountId. Must be a positive integer (digits only). */
function parseId(raw, { field, code }) {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,14}$/.test(raw)) {
    throw new ValidationError(
      [{ field, code, message: `${field} must be a positive integer` }],
      code,
      `Invalid ${field.replace(/_/g, ' ')}`
    );
  }
  return Number(raw);
}

const parseAccountId = (raw) =>
  parseId(raw, { field: 'account_id', code: 'INVALID_ACCOUNT_ID' });

const parseTransactionId = (raw) =>
  parseId(raw, { field: 'transaction_id', code: 'INVALID_TRANSACTION_ID' });

function readPositiveInt(raw, field, fallback, max, details) {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    details.push({
      field,
      code: 'INVALID_PAGINATION',
      message: `${field} must be a positive integer`,
    });
    return fallback;
  }
  const value = Number(raw);
  if (value < 1 || value > max) {
    details.push({
      field,
      code: 'INVALID_PAGINATION',
      message: `${field} must be between 1 and ${max}`,
    });
    return fallback;
  }
  return value;
}

/** ?page=1&limit=10  (defaults: page 1, limit 10, max limit 100). */
function parsePagination(query = {}) {
  const details = [];
  const page = readPositiveInt(query.page, 'page', DEFAULT_PAGE, MAX_PAGE, details);
  const limit = readPositiveInt(query.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT, details);
  if (details.length > 0) {
    throw new ValidationError(details, 'INVALID_PAGINATION', 'Invalid pagination parameters');
  }
  return { page, limit };
}

module.exports = {
  parseBody,
  parseAccountId,
  parseTransactionId,
  parsePagination,
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
