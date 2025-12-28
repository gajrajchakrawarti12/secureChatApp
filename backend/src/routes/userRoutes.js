const express = require('express');
const { z } = require('zod');

const userController = require('../controllers/userController');
const { asyncHandler } = require('../middlewares/asyncHandler');
const { validate } = require('../middlewares/validate');
const { auth } = require('../middlewares/auth');

const router = express.Router();

const idParams = z.object({ id: z.coerce.number().int().positive() });

router.get('/all', auth, asyncHandler(userController.listAll));
router.get('/contacts', auth, asyncHandler(userController.contacts));
router.get('/:id/public-key', auth, validate({ params: idParams }), asyncHandler(userController.publicKey));

module.exports = router;
