const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireJson, methodNotAllowed } = require('../middleware/http');
const controller = require('../controllers/accountController');
const transactionRoutes = require('./transactionRoutes');

const router = express.Router();

router
  .route('/')
  .get(asyncHandler(controller.list))
  .post(requireJson, asyncHandler(controller.create))
  .all(methodNotAllowed(['GET', 'POST']));

router
  .route('/:accountId')
  .get(asyncHandler(controller.getOne))
  .all(methodNotAllowed(['GET']));

router.use('/:accountId/transactions', transactionRoutes);

module.exports = router;
