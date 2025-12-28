const crypto = require('crypto');

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
}

function getPushTokenKey() {
  const { PUSH_TOKEN_ENC_KEY = '', JWT_SECRET = '', NODE_ENV = 'development' } = process.env;

  if (PUSH_TOKEN_ENC_KEY) {
    const key = Buffer.from(PUSH_TOKEN_ENC_KEY, 'base64');
    if (key.length !== 32) {
      throw new Error('PUSH_TOKEN_ENC_KEY must be base64-encoded 32 bytes');
    }
    return key;
  }

  // Dev fallback: derive a stable key from JWT_SECRET so local runs work without extra env.
  if (NODE_ENV !== 'production' && JWT_SECRET) {
    return crypto.createHash('sha256').update(String(JWT_SECRET), 'utf8').digest();
  }

  throw new Error('Missing PUSH_TOKEN_ENC_KEY (base64 32 bytes)');
}

function encryptPushToken(token) {
  const key = getPushTokenKey();
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, nonce, tag, tokenHash: sha256Hex(token) };
}

function decryptPushToken({ ciphertext, nonce, tag }) {
  const key = getPushTokenKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}

module.exports = { encryptPushToken, decryptPushToken, sha256Hex };
