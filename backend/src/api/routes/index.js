const express = require('express');
const authRoutes = require('../../modules/auth/auth.routes');
const userRoutes = require('../../modules/users/users.routes');
const messageRoutes = require('../../modules/messages/messages.routes');

const apiRouter = express.Router();

apiRouter.use('/auth', authRoutes);
apiRouter.use('/user', userRoutes);
apiRouter.use('/messages', messageRoutes);

module.exports = apiRouter;
