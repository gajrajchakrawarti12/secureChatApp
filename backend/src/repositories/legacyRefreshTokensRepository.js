const { getPool } = require('../infra/db');

async function insertToken({ userId, tokenHash, jti }) {
  const pool = getPool();
  if (jti) {
    await pool.query('INSERT INTO refresh_tokens (user_id, token, jti) VALUES (?, ?, ?)', [userId, tokenHash, jti]);
    return;
  }
  await pool.query('INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)', [userId, tokenHash]);
}

async function listTokensForUser(userId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, token, jti FROM refresh_tokens WHERE user_id = ?', [userId]);
  return rows || [];
}

async function findTokenByUserAndJti({ userId, jti }) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, token, jti FROM refresh_tokens WHERE user_id = ? AND jti = ? LIMIT 1', [userId, jti]);
  return rows && rows.length ? rows[0] : null;
}

async function deleteTokenById(id) {
  const pool = getPool();
  await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [id]);
}

async function deleteAllForUser(userId) {
  const pool = getPool();
  await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

module.exports = {
  insertToken,
  listTokensForUser,
  findTokenByUserAndJti,
  deleteTokenById,
  deleteAllForUser,
};
