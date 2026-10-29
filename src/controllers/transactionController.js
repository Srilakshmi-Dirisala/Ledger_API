const transactionService = require('../services/transactionService');
const {
  parseBody,
  parseAccountId,
  parseTransactionId,
  parsePagination,
} = require('../validators/parse');
const { createTransactionSchema } = require('../validators/schemas');

async function create(req, res) {
  const accountId = parseAccountId(req.params.accountId);
  const input = parseBody(createTransactionSchema, req.body);
  const { transaction, account } = await transactionService.createTransaction(accountId, input);
  res
    .status(201)
    .location(`/accounts/${accountId}/transactions/${transaction.id}`)
    .json({ data: transaction, account });
}

async function list(req, res) {
  const accountId = parseAccountId(req.params.accountId);
  const paging = parsePagination(req.query);
  const { items, pagination } = await transactionService.listTransactions(accountId, paging);
  res.json({ data: items, pagination });
}

async function getOne(req, res) {
  const accountId = parseAccountId(req.params.accountId);
  const transactionId = parseTransactionId(req.params.transactionId);
  const transaction = await transactionService.getTransaction(accountId, transactionId);
  res.json({ data: transaction });
}

module.exports = { create, list, getOne };
