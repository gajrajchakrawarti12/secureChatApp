const { getPool } = require('../infra/db');

async function findByEmail(email) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, email, password_hash, salt, public_key, encrypted_private_key, mac, nonce, iv, created_at FROM users WHERE email = ? LIMIT 1', [email]);
  return rows && rows.length ? rows[0] : null;
}

async function findById(userId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, email, public_key, encrypted_private_key, mac, nonce, salt, iv, created_at FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0] : null;
}

async function createUser({ email, passwordHash, publicKey, encryptedPrivateKey, mac, nonce, salt, iv }) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO users (email, password_hash, public_key, encrypted_private_key, mac, nonce, salt, iv) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [email, passwordHash, publicKey, encryptedPrivateKey, mac, nonce, salt, iv]
  );

  const created = await findByEmail(email);
  return created;
}

async function listAllExceptUser(userId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT id, public_key FROM users WHERE id != ?', [userId]);
  return rows || [];
}

async function getPublicKeyById(userId) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT public_key FROM users WHERE id = ? LIMIT 1', [userId]);
  return rows && rows.length ? rows[0].public_key : null;
}

async function listContactsForUser(userId) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT u.id, u.public_key FROM users u
     JOIN messages m ON (u.id = m.sender_id OR u.id = m.receiver_id)
     WHERE u.id != ? AND (m.sender_id = ? OR m.receiver_id = ?)
     GROUP BY u.id`,
    [userId, userId, userId]
  );
  return rows || [];
}

module.exports = {
  findByEmail,
  findById,
  createUser,
  listAllExceptUser,
  getPublicKeyById,
  listContactsForUser,
};
