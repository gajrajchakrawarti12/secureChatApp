const { getPool } = require('../../infra/db');
const admin = require('../../infra/firebase/admin');
const { encryptPushToken, decryptPushToken, sha256Hex } = require('../../infra/crypto/pushTokenCrypto');

const { DB_DRIVER = 'mysql' } = process.env;

function usingFirestore() {
  return String(DB_DRIVER).toLowerCase() === 'firebase';
}

// Firestore collection 'push_tokens'
// Document fields: { id, user_id, token_hash, token_ciphertext_b64, nonce_b64, tag_b64, created_at }
const firestore = admin.firestore();
const colPush = () => firestore.collection('push_tokens');

async function saveUserToken(userId, token) {
  if (!userId || !token) return;
  const uid = Number(userId);
  const tokenHash = sha256Hex(token);

  if (usingFirestore()) {
    const enc = encryptPushToken(token);
    const docId = `${uid}:${tokenHash}`;
    await colPush().doc(docId).set(
      {
        id: docId,
        user_id: uid,
        token_hash: tokenHash,
        token_ciphertext_b64: enc.ciphertext.toString('base64'),
        nonce_b64: enc.nonce.toString('base64'),
        tag_b64: enc.tag.toString('base64'),
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return;
  }

  const enc = encryptPushToken(token);
  const pool = getPool();
  await pool.execute(
    'INSERT INTO push_tokens (user_id, token_hash, token_ciphertext, nonce, tag) VALUES (?, ?, ?, ?, ?)\n' +
      'ON DUPLICATE KEY UPDATE token_ciphertext=VALUES(token_ciphertext), nonce=VALUES(nonce), tag=VALUES(tag)',
    [uid, tokenHash, enc.ciphertext, enc.nonce, enc.tag]
  );
}

async function deleteUserToken(userId, token) {
  if (!userId || !token) return;
  const uid = Number(userId);
  const tokenHash = sha256Hex(token);

  if (usingFirestore()) {
    const docId = `${uid}:${tokenHash}`;
    await colPush().doc(docId).delete();
    return;
  }

  const pool = getPool();
  await pool.execute('DELETE FROM push_tokens WHERE user_id = ? AND token_hash = ? LIMIT 1', [uid, tokenHash]);
}

async function getUserTokens(userId) {
  const uid = Number(userId);

  if (usingFirestore()) {
    const snap = await colPush().where('user_id', '==', uid).get();
    const tokens = [];
    snap.docs.forEach((d) => {
      const ctB64 = d.get('token_ciphertext_b64');
      const nonceB64 = d.get('nonce_b64');
      const tagB64 = d.get('tag_b64');
      if (!ctB64 || !nonceB64 || !tagB64) return;
      try {
        tokens.push(
          decryptPushToken({
            ciphertext: Buffer.from(String(ctB64), 'base64'),
            nonce: Buffer.from(String(nonceB64), 'base64'),
            tag: Buffer.from(String(tagB64), 'base64'),
          })
        );
      } catch (_) {}
    });
    return tokens;
  }

  const pool = getPool();
  const [rows] = await pool.execute(
    'SELECT token_ciphertext, nonce, tag FROM push_tokens WHERE user_id = ? ORDER BY id DESC',
    [uid]
  );
  return (rows || [])
    .map((r) => {
      try {
        return decryptPushToken({
          ciphertext: Buffer.from(r.token_ciphertext),
          nonce: Buffer.from(r.nonce),
          tag: Buffer.from(r.tag),
        });
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean);
}

async function deleteAllUserTokens(userId) {
  if (!userId) return;
  const uid = Number(userId);

  if (usingFirestore()) {
    const snap = await colPush().where('user_id', '==', uid).get();
    if (snap.empty) return;
    const batch = firestore.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    return;
  }

  const pool = getPool();
  await pool.execute('DELETE FROM push_tokens WHERE user_id = ?', [uid]);
}

module.exports = { saveUserToken, deleteUserToken, deleteAllUserTokens, getUserTokens };
