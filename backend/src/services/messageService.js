const messagesRepository = require('../repositories/messagesRepository');

async function listConversation({ senderId, receiverId, limit }) {
  return messagesRepository.listBetweenUsers({ senderId, receiverId, limit });
}

module.exports = { listConversation };
