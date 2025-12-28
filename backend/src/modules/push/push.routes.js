// backend/routes/push.js
const express = require("express");
const router = express.Router();
const { saveUserToken, deleteUserToken } = require("./pushTokens.js");
const { auth } = require("../../api/middleware/auth");
const { asyncHandler } = require("../../api/middleware/asyncHandler");

router.use(express.json({ limit: '32kb' }));

// Assume req.user.id from auth middleware
router.post("/register", auth, asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });
  if (typeof token !== 'string' || token.length > 4096) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  await saveUserToken(req.user?.id || req.user?.userId, token); // upsert in DB
  res.json({ ok: true });
}));

router.post("/unregister", auth, asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: "Missing token" });
  if (typeof token !== 'string' || token.length > 4096) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  await deleteUserToken(req.user?.id || req.user?.userId, token); // remove from DB
  res.json({ ok: true });
}));

module.exports = router;
