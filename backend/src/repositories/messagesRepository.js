const { getPool } = require('../infra/db');

async function listBetweenUsers({ senderId, receiverId, limit }) {
  const pool = getPool();
  // Inline validated LIMIT to avoid prepared statement limitations
  const sql =
    `SELECT * FROM messages
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY timestamp ASC LIMIT ${limit}`;

  const [rows] = await pool.execute(sql, [senderId, receiverId, receiverId, senderId]);
  return rows || [];
}

async function insertMessage({ senderId, receiverId, encryptedMessage }) {
  const pool = getPool();
  const [res] = await pool.execute(
    'INSERT INTO messages (sender_id, receiver_id, encrypted_message) VALUES (?, ?, ?)',
    [senderId, receiverId, encryptedMessage]
  );
  return res && res.insertId ? Number(res.insertId) : null;
}

async function findMessageById(id) {
  const pool = getPool();
  const [[row]] = await pool.execute(
    'SELECT id, sender_id, receiver_id, encrypted_message, timestamp FROM messages WHERE id = ? LIMIT 1',
    [id]
  );
  return row || null;
}

module.exports = { listBetweenUsers, insertMessage, findMessageById };
