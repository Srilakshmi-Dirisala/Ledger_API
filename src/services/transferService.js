const { withTransaction } = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const transactionRepository = require('../repositories/transactionRepository');
const transferRepository = require('../repositories/transferRepository');
const {
  AccountNotFoundError,
  InsufficientBalanceError,
  DuplicateTransactionError,
} = require('../errors/AppError');

/**
 * Moves money from one account to another. The debit, the credit, the transfer record and both
 * ledger rows are written inside ONE database transaction: either all of it is committed or none
 * of it is, so a partial transfer is impossible.
 *
 * Deadlock safety: both account rows are locked in ascending id order, so A->B and B->A running
 * concurrently always take their locks in the same order.
 */
async function createTransfer({
  from_account_id: fromId,
  to_account_id: toId,
  amount,
  description,
  reference_id: referenceId,
}) {
  return withTransaction(async (client) => {
    // 1. Lock both accounts (ordered by id) and make sure both exist.
    const locked = await accountRepository.lockByIds(client, [fromId, toId]);
    const from = locked.find((a) => a.id === fromId);
    const to = locked.find((a) => a.id === toId);
    if (!from) throw new AccountNotFoundError(fromId);
    if (!to) throw new AccountNotFoundError(toId);

    // 2. reference_id must be unused on BOTH accounts (it is unique per account).
    const duplicates = await transactionRepository.findByReference(client, [fromId, toId], referenceId);
    if (duplicates.length > 0) {
      throw new DuplicateTransactionError(duplicates[0].account_id, referenceId, duplicates[0].id);
    }

    // 3. Move the money. The debit only succeeds if the source balance covers it.
    const amountText = amount.toFixed(2);
    const fromBalance = await accountRepository.debitIfSufficient(client, fromId, amountText);
    if (fromBalance === null) {
      throw new InsufficientBalanceError(fromId, from.balance, amount);
    }
    const toBalance = await accountRepository.credit(client, toId, amountText);

    // 4. Record the transfer and its two ledger rows.
    const transfer = await transferRepository.insert(client, {
      fromAccountId: fromId,
      toAccountId: toId,
      amount: amountText,
      description: description ?? null,
      referenceId,
    });

    const debitTransaction = await transactionRepository.insert(client, {
      accountId: fromId,
      transferId: transfer.id,
      type: 'debit',
      amount: amountText,
      description: description ?? `Transfer to account ${toId}`,
      referenceId,
    });

    const creditTransaction = await transactionRepository.insert(client, {
      accountId: toId,
      transferId: transfer.id,
      type: 'credit',
      amount: amountText,
      description: description ?? `Transfer from account ${fromId}`,
      referenceId,
    });

    return {
      transfer,
      debitTransaction,
      creditTransaction,
      accounts: {
        from: { id: fromId, balance: fromBalance },
        to: { id: toId, balance: toBalance },
      },
    };
  });
}

module.exports = { createTransfer };
