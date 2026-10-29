const accountService = require('../services/accountService');
const { parseBody, parseAccountId, parsePagination } = require('../validators/parse');
const { createAccountSchema } = require('../validators/schemas');

async function create(req, res) {
  const input = parseBody(createAccountSchema, req.body);
  const account = await accountService.createAccount(input);
  res.status(201).location(`/accounts/${account.id}`).json({ data: account });
}

async function getOne(req, res) {
  const id = parseAccountId(req.params.accountId);
  const account = await accountService.getAccount(id);
  res.json({ data: account });
}

async function list(req, res) {
  const paging = parsePagination(req.query);
  const { items, pagination } = await accountService.listAccounts(paging);
  res.json({ data: items, pagination });
}

module.exports = { create, getOne, list };
