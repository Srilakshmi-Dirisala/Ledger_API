const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { requireJson, methodNotAllowed } = require('../middleware/http');
const controller = require('../controllers/transferController');

const router = express.Router();

router
  .route('/')
  .post(requireJson, asyncHandler(controller.create))
  .all(methodNotAllowed(['POST']));

module.exports = router;
