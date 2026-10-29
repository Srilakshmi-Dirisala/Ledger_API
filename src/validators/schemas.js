const { z } = require('zod');

// Largest value NUMERIC(14,2) can hold.
const MAX_AMOUNT = 999999999999.99;

// 19.99 -> true, 1.005 -> false, 0.1 + 0.2 -> false
const hasAtMostTwoDecimals = (value) => Number(value.toFixed(2)) === value;

// Error message for a wrong-typed value ("<field> must be <what>"). A MISSING value is reported
// separately as MISSING_FIELD by parse.js, so its message here is never shown.
const wrongType = (field, what) => ({ error: `${field} must be ${what}` });

const amount = z
  .number(wrongType('amount', 'a number'))
  .gt(0, 'amount must be greater than 0')
  .refine(hasAtMostTwoDecimals, 'amount must have at most 2 decimal places')
  .refine((value) => value <= MAX_AMOUNT, `amount must not exceed ${MAX_AMOUNT}`);

const referenceId = z
  .string(wrongType('reference_id', 'a string'))
  .trim()
  .min(1, 'reference_id must not be empty')
  .max(100, 'reference_id must be at most 100 characters');

// Optional. Missing / null / blank all become null.
const description = z
  .string(wrongType('description', 'a string'))
  .trim()
  .max(500, 'description must be at most 500 characters')
  .nullish()
  .transform((value) => (value ? value : null));

const accountIdInBody = (field) =>
  z
    .number(wrongType(field, 'an integer'))
    .int(`${field} must be an integer`)
    .positive(`${field} must be a positive integer`)
    .max(Number.MAX_SAFE_INTEGER, `${field} is too large`);

// strictObject rejects unknown keys, e.g. a client trying to send { "balance": 1000000 }.
const createAccountSchema = z.strictObject({
  name: z
    .string(wrongType('name', 'a string'))
    .trim()
    .min(1, 'name must not be empty')
    .max(100, 'name must be at most 100 characters'),
});

const createTransactionSchema = z.strictObject({
  type: z.enum(['credit', 'debit'], { error: "type must be either 'credit' or 'debit'" }),
  amount,
  description,
  reference_id: referenceId,
});

const createTransferSchema = z
  .strictObject({
    from_account_id: accountIdInBody('from_account_id'),
    to_account_id: accountIdInBody('to_account_id'),
    amount,
    description,
    reference_id: referenceId,
  })
  .refine((body) => body.from_account_id !== body.to_account_id, {
    path: ['to_account_id'],
    error: 'to_account_id must be different from from_account_id',
  });

module.exports = {
  MAX_AMOUNT,
  createAccountSchema,
  createTransactionSchema,
  createTransferSchema,
};
