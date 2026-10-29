const { pool, withSnapshot } = require('../config/db');
const accountRepository = require('../repositories/accountRepository');
const { AccountNotFoundError } = require('../errors/AppError');
const { buildPagination, toOffset } = require('../utils/pagination');

/** New accounts always start with a balance of 0 (the balance column default). */
async function createAccount({ name }) {
  return accountRepository.insert(pool, name);
}

async function getAccount(id) {
  const account = await accountRepository.findById(pool, id);
  if (!account) throw new AccountNotFoundError(id);
  return account;
}

async function listAccounts({ page, limit }) {
  return withSnapshot(async (client) => {
    const total = await accountRepository.count(client);
    const items = await accountRepository.findPage(client, limit, toOffset({ page, limit }));
    return { items, pagination: buildPagination({ page, limit, total }) };
  });
}

module.exports = { createAccount, getAccount, listAccounts };
