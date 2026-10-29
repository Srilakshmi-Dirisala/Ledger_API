const { withTransaction, withSnapshot } = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const transactionRepository = require('../repositories/transactionRepository');
const {
  AccountNotFoundError,
  TransactionNotFoundError,
  InsufficientBalanceError,
  DuplicateTransactionError,
} = require('../errors/AppError');
const { buildPagination, toOffset } = require('../utils/pagination');

/**
 * Creates a credit/debit AND updates the account balance as ONE atomic operation.
 *
 * Everything below runs inside a single database transaction (withTransaction):
 * if any step throws, PostgreSQL rolls back and neither the ledger row nor the balance changes.
 *
 * Concurrency: step 1 takes a row lock on the account (SELECT ... FOR UPDATE). Concurrent
 * requests for the SAME account therefore run one after another, so two debits can never both
 * "see" the same balance, and the duplicate check in step 2 can never race.
 */
async function createTransaction(accountId, { type, amount, description, reference_id: referenceId }) {
  return withTransaction(async (client) => {
    // 1. Lock the account (also proves it exists).
    const account = await accountRepository.lockById(client, accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    // 2. Duplicate reference_id for this account? (Checked before the balance so a retry of a
    //    successful debit reports "duplicate", not a confusing "insufficient balance".)
    const duplicates = await transactionRepository.findByReference(client, [accountId], referenceId);
    if (duplicates.length > 0) {
      throw new DuplicateTransactionError(accountId, referenceId, duplicates[0].id);
    }

    // 3. Change the balance.
    let newBalance;
    if (type === 'credit') {
      newBalance = await accountRepository.credit(client, accountId, amount.toFixed(2));
    } else {
      newBalance = await accountRepository.debitIfSufficient(client, accountId, amount.toFixed(2));
      if (newBalance === null) {
        throw new InsufficientBalanceError(accountId, account.balance, amount);
      }
    }

    // 4. Append the immutable ledger row.
    const transaction = await transactionRepository.insert(client, {
      accountId,
      type,
      amount: amount.toFixed(2),
      description: description ?? null,
      referenceId,
    });

    return { transaction, account: { id: accountId, balance: newBalance } };
  });
}

/** Latest-first page of an account's transactions plus pagination metadata. */
async function listTransactions(accountId, { page, limit }) {
  return withSnapshot(async (client) => {
    const account = await accountRepository.findById(client, accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    const total = await transactionRepository.countByAccount(client, accountId);
    const items = await transactionRepository.findPageByAccount(
      client,
      accountId,
      limit,
      toOffset({ page, limit })
    );
    return { items, pagination: buildPagination({ page, limit, total }) };
  });
}

async function getTransaction(accountId, transactionId) {
  return withSnapshot(async (client) => {
    const account = await accountRepository.findById(client, accountId);
    if (!account) throw new AccountNotFoundError(accountId);

    const transaction = await transactionRepository.findById(client, accountId, transactionId);
    if (!transaction) throw new TransactionNotFoundError(transactionId);
    return transaction;
  });
}

module.exports = { createTransaction, listTransactions, getTransaction };
