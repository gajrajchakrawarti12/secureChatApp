const express = require('express');
const router = express.Router();
const { getPool } = require('../../infra/db');
const { auth } = require('../../api/middleware/auth');
const { logError } = require('../../infra/logging/logger');

// GET /api/messages/:id?limit=50 - fetch messages between authenticated user and user with :id
router.get('/:id', auth, async (req, res) => {
  const receiver_id = parseInt(req.params.id, 10);
  const sender_id = parseInt(String(req.user?.userId), 10);
  let limit = parseInt(String(req.query.limit || '50'), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 50;
  if (limit > 100) limit = 100;

  if (!Number.isFinite(sender_id) || !Number.isFinite(receiver_id)) {
    return res.status(400).json({ error: 'sender_id and receiver_id are required and must be numbers' });
  }

  try {
    const pool = getPool();
    // Inline validated LIMIT to avoid prepared statement type issues
    const sql =
      `SELECT * FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY timestamp ASC LIMIT ${limit}`;
    const [rows] = await pool.execute(sql, [sender_id, receiver_id, receiver_id, sender_id]);

    res.json({ ok: true, messages: rows });
  } catch (err) {
    try { logError(err); } catch (_) { console.error(err); }
    res.status(500).json({ error: 'failed to fetch messages' });
  }
});

module.exports = router;
