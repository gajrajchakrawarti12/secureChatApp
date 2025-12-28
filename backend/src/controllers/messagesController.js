const messageService = require('../services/messageService');
const { sendSuccess } = require('../utils/response');

async function listConversation(req, res) {
  const receiverId = Number(req.params.id);
  const senderId = Number(req.user.userId);
  const limit = Number(req.query.limit);

  const messages = await messageService.listConversation({ senderId, receiverId, limit });
  return sendSuccess(res, { message: 'ok', data: { messages } });
}

module.exports = { listConversation };
