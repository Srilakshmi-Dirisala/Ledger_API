const transferService = require('../services/transferService');
const { parseBody } = require('../validators/parse');
const { createTransferSchema } = require('../validators/schemas');

async function create(req, res) {
  const input = parseBody(createTransferSchema, req.body);
  const { transfer, debitTransaction, creditTransaction, accounts } =
    await transferService.createTransfer(input);

  res.status(201).json({
    data: {
      ...transfer,
      debit_transaction: debitTransaction,
      credit_transaction: creditTransaction,
    },
    accounts,
  });
}

module.exports = { create };
