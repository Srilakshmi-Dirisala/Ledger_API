const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireJson, methodNotAllowed, transactionImmutable } = require('../middleware/http');
const controller = require('../controllers/transactionController');

// mergeParams makes :accountId from the parent router (/accounts/:accountId) visible here.
const router = express.Router({ mergeParams: true });

router
  .route('/')
  .get(asyncHandler(controller.list))
  .post(requireJson, asyncHandler(controller.create))
  .all(methodNotAllowed(['GET', 'POST']));

// Transactions can be read but never changed: PUT / PATCH / DELETE are rejected with 405.
router
  .route('/:transactionId')
  .get(asyncHandler(controller.getOne))
  .all(transactionImmutable);

module.exports = router;
