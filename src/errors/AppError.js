/**
 * Every error the API intentionally returns is an AppError. The central error handler turns it into:
 *   { "error": { "code": "...", "message": "...", "details": [ ... ] } }
 * `details` is ALWAYS an array of objects (empty when there is nothing extra to say).
 */
class AppError extends Error {
  constructor(status, code, message, details = [], headers = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

class ValidationError extends AppError {
  constructor(details, code = 'VALIDATION_ERROR', message = 'Request validation failed') {
    super(400, code, message, details);
  }
}

class AccountNotFoundError extends AppError {
  constructor(accountId) {
    super(404, 'ACCOUNT_NOT_FOUND', `Account ${accountId} not found`, [
      { field: 'account_id', value: accountId },
    ]);
  }
}

class TransactionNotFoundError extends AppError {
  constructor(transactionId) {
    super(404, 'TRANSACTION_NOT_FOUND', `Transaction ${transactionId} not found`);
  }
}

class InsufficientBalanceError extends AppError {
  constructor(accountId, availableBalance, requestedAmount) {
    super(
      422,
      'INSUFFICIENT_BALANCE',
      `Account ${accountId} has insufficient balance for this debit`,
      [
        {
          account_id: accountId,
          available_balance: availableBalance,
          requested_amount: requestedAmount,
        },
      ]
    );
  }
}

class DuplicateTransactionError extends AppError {
  constructor(accountId, referenceId, existingTransactionId) {
    super(
      409,
      'DUPLICATE_TRANSACTION',
      `A transaction with reference_id '${referenceId}' already exists for account ${accountId}`,
      [
        {
          field: 'reference_id',
          account_id: accountId,
          reference_id: referenceId,
          ...(existingTransactionId ? { existing_transaction_id: existingTransactionId } : {}),
        },
      ]
    );
  }
}

module.exports = {
  AppError,
  ValidationError,
  AccountNotFoundError,
  TransactionNotFoundError,
  InsufficientBalanceError,
  DuplicateTransactionError,
};
