const express = require('express');

const authRoutes = require('./authRoutes');
const userRoutes = require('./userRoutes');
const messagesRoutes = require('./messagesRoutes');

const router = express.Router();

// Versioned API
const v1 = express.Router();
v1.use('/auth', authRoutes);
v1.use('/user', userRoutes);
v1.use('/messages', messagesRoutes);

router.use('/v1', v1);

module.exports = router;
