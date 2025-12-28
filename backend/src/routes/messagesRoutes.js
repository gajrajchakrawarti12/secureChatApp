const express = require('express');
const { z } = require('zod');

const messagesController = require('../controllers/messagesController');
const { asyncHandler } = require('../middlewares/asyncHandler');
const { validate } = require('../middlewares/validate');
const { auth } = require('../middlewares/auth');

const router = express.Router();

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });

router.get('/:id', auth, validate({ params: idParams, query: listQuery }), asyncHandler(messagesController.listConversation));

module.exports = router;
