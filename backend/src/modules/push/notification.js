const admin = require('../../infra/firebase/admin');
const { getUserTokens, deleteUserToken } = require('./pushTokens');

async function sendMessageNotification({ receiverId, senderId, messageId }) {
  const tokens = await getUserTokens(receiverId);
  if (!tokens?.length) return;
  const message = {
    // Data-only payload (no message content). Client decides how to display.
    data: {
      type: "message",
      title: 'New message',
      body: 'Open the app to view it.',
      receiver_id: String(receiverId),
      sender_id: senderId != null ? String(senderId) : "",
      message_id: messageId != null ? String(messageId) : "",
    },
    tokens,
  };

  const resp = await admin.messaging().sendMulticast(message);
  // Best-effort cleanup of invalid tokens.
  try {
    if (resp && Array.isArray(resp.responses)) {
      for (let i = 0; i < resp.responses.length; i += 1) {
        const r = resp.responses[i];
        if (!r || r.success) continue;
        const code = r.error && r.error.code ? String(r.error.code) : '';
        // Common invalid-token cases.
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('messaging/registration-token-not-registered') ||
          code.includes('messaging/invalid-registration-token')
        ) {
          const bad = tokens[i];
          if (bad) await deleteUserToken(receiverId, bad);
        }
      }
    }
  } catch (_) {}
}
module.exports = { sendMessageNotification };
