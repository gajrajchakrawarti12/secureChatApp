const userService = require('../services/userService');
const { sendSuccess } = require('../utils/response');

async function listAll(req, res) {
  const users = await userService.listAllUsers({ currentUserId: req.user.userId });
  return sendSuccess(res, { message: 'ok', data: { users } });
}

async function publicKey(req, res) {
  const userId = Number(req.params.id);
  const publicKey = await userService.getPublicKey({ userId });
  return sendSuccess(res, { message: 'ok', data: { publicKey } });
}

async function contacts(req, res) {
  const contacts = await userService.listContacts({ currentUserId: req.user.userId });
  return sendSuccess(res, { message: 'ok', data: { contacts } });
}

module.exports = { listAll, publicKey, contacts };
