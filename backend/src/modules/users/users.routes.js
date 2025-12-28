const express = require("express");
const { getPool } = require("../../infra/db");
const { logError } = require("../../infra/logging/logger");
const { auth } = require("../../api/middleware/auth");

const userRouter = express.Router();

const pool = getPool();

userRouter.get("/all", auth, async (req, res) => {
  try {
    const [users] = await pool.query("SELECT id, public_key FROM users where id != ?", [req.user.userId]);
    res.json({ ok: true, users });
  } catch (err) {
    logError(err);
    res.status(500).json({ error: "internal server error" });
  }
});

userRouter.get("/:id/public-key", auth, async (req, res) => {
  try {
    const userId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'invalid user id' });
    const [rows] = await pool.query(
      "SELECT public_key FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    res.json({ ok: true, publicKey: rows[0].public_key });
  } catch (err) {
    logError(err);
    res.status(500).json({ error: "internal server error" });
  }
});

userRouter.get("/contacts", auth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const [rows] = await pool.query(
            `SELECT u.id, u.public_key FROM users u
             JOIN messages m ON (u.id = m.sender_id OR u.id = m.receiver_id)
                WHERE u.id != ? AND (m.sender_id = ? OR m.receiver_id = ?)
                GROUP BY u.id`,
            [userId, userId, userId]
        );
        res.json({ ok: true, contacts: rows });
    } catch (err) {
        logError(err);
        res.status(500).json({ error: "internal server error" });
    }
});

module.exports = userRouter;
