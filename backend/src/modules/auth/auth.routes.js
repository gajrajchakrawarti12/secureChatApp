const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { getPool } = require("../../infra/db");
const { logError } = require("../../infra/logging/logger");
const {
  parseOpaqueRefreshToken,
  issueRefreshSession,
  verifyRefreshSession,
  rotateRefreshSession,
  revokeRefreshSession,
  revokeAllRefreshForUser,
} = require("./refreshSessions");
const { auth } = require("../../api/middleware/auth");
const { asyncHandler } = require("../../api/middleware/asyncHandler");
const { rateLimit } = require("../../api/middleware/rateLimit");
const express = require("express");
const { deleteAllUserTokens } = require("../push/pushTokens");

const authRouter = express.Router();
authRouter.use(express.json({ limit: '512kb' }));

const {
  JWT_SECRET = "changeme",
  JWT_EXPIRES_IN = "1h",
  JWT_REFRESH_EXPIRES_IN = "7d",
  NODE_ENV = "development",
} = process.env;

const pool = getPool();

const authLimiter = rateLimit({ windowMs: 60_000, max: 60 });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 20 });

function signAccessToken({ userId, email }) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function signRefreshToken({ userId, email, jti }) {
  // Legacy refresh tokens are JWTs (kept for backward compatibility).
  const payload = jti ? { userId, email, jti } : { userId, email };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_REFRESH_EXPIRES_IN });
}

async function revokeAllRefreshTokensForUser(userId) {
  try {
    await pool.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
  } catch (e) {
    try { logError(e); } catch (_) {}
  }
}

authRouter.post("/register", authLimiter, asyncHandler(async (req, res) => {
    const { email, password, publicKey, encryptedPrivateKey, mac, nonce, salt, iv } =
      req.body;
    if (
      !email ||
      !password ||
      !publicKey ||
      !encryptedPrivateKey ||
      !mac ||
      !nonce ||
      !salt ||
      !iv
    )
      return res.status(400).json({ error: "missing required fields" });

    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.length > 254) return res.status(400).json({ error: 'invalid email' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'invalid email' });
    }

    if (typeof password !== 'string' || password.length < 8 || password.length > 1024) {
      return res.status(400).json({ error: 'invalid password' });
    }

    const maxKeyBlob = 256 * 1024; // generous to avoid breaking existing clients
    const maxSmall = 4 * 1024;
    if (typeof publicKey !== 'string' || publicKey.length === 0 || publicKey.length > maxKeyBlob) {
      return res.status(400).json({ error: 'invalid publicKey' });
    }
    if (typeof encryptedPrivateKey !== 'string' || encryptedPrivateKey.length === 0 || encryptedPrivateKey.length > maxKeyBlob) {
      return res.status(400).json({ error: 'invalid encryptedPrivateKey' });
    }
    if (typeof mac !== 'string' || mac.length === 0 || mac.length > maxSmall) return res.status(400).json({ error: 'invalid mac' });
    if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > maxSmall) return res.status(400).json({ error: 'invalid nonce' });
    if (typeof salt !== 'string' || salt.length === 0 || salt.length > maxSmall) return res.status(400).json({ error: 'invalid salt' });
    if (typeof iv !== 'string' || iv.length === 0 || iv.length > maxSmall) return res.status(400).json({ error: 'invalid iv' });
    const [exists] = await pool.query("SELECT id FROM users WHERE email = ?", [
      normalizedEmail,
    ]);
    if (exists.length)
      return res.status(409).json({ error: "email already registered" });

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (email, password_hash, public_key, encrypted_private_key, mac, nonce, salt, iv) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [normalizedEmail, passwordHash, publicKey, encryptedPrivateKey, mac, nonce, salt, iv]
    );

    res.json({ ok: true, message: "registration successful" });
}));

authRouter.post("/login", loginLimiter, asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password required" });

  const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.length > 254) return res.status(400).json({ error: 'email and password required' });
    if (typeof password !== 'string' || password.length > 1024) {
      return res.status(400).json({ error: 'email and password required' });
    }

    const [rows] = await pool.query(
      `SELECT id, password_hash, salt FROM users WHERE email = ?`,
      [normalizedEmail]
    );
    if (!rows.length)
      return res.status(401).json({ error: "invalid credentials" });
    const user = rows[0];

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "invalid credentials" });

    const token = signAccessToken({ userId: user.id, email: normalizedEmail });

    // Prefer opaque refresh sessions (hash-only storage) going forward.
    // If anything fails (e.g., migrations not applied), fall back to legacy JWT refresh.
    let refreshToken;
    try {
      const deviceId = req.get('x-device-id') || null;
      if (NODE_ENV === 'production' && !deviceId) {
        return res.status(400).json({ error: 'missing x-device-id' });
      }
      const userAgent = req.get('user-agent') || '';
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();
      const issued = await issueRefreshSession({
        userId: user.id,
        deviceId,
        userAgent,
        ip,
      });
      refreshToken = issued.refreshToken;
    } catch (e) {
      try { logError(e); } catch (_) {}

      const jti = uuidv4();
      const legacyRefresh = signRefreshToken({ userId: user.id, email: normalizedEmail, jti });
      const legacyHash = await bcrypt.hash(legacyRefresh, 12);
      try {
        if (typeof pool.getConnection === 'function') {
          await pool.query(
            "INSERT INTO refresh_tokens (user_id, token, jti) VALUES (?, ?, ?)",
            [user.id, legacyHash, jti]
          );
        } else {
          await pool.query(
            "INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)",
            [user.id, legacyHash]
          );
        }
        refreshToken = legacyRefresh;
      } catch (dbErr) {
        logError(dbErr);
        return res.status(500).json({ error: "failed to store refresh token" });
      }
    }

    res.json({
      ok: true,
      token,
      refreshToken,
      salt: user.salt,
    });
}));

authRouter.post("/refresh", loginLimiter, asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ error: "refreshToken required" });

    // Opaque refresh session path.
    if (parseOpaqueRefreshToken(refreshToken)) {
      const deviceId = req.get('x-device-id') || null;
      if (NODE_ENV === 'production' && !deviceId) {
        return res.status(400).json({ error: 'missing x-device-id' });
      }
      const userAgent = req.get('user-agent') || '';
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();

      let rotated;
      try {
        rotated = await rotateRefreshSession({ refreshToken, deviceId, userAgent, ip });
      } catch (e) {
        try { logError(e); } catch (_) {}
        return res.status(500).json({ error: 'failed to rotate refresh token' });
      }

      if (!rotated || !rotated.ok) {
        // Reuse detection for opaque tokens happens inside the rotation helper.
        const msg = rotated && rotated.reason === 'expired'
          ? 'invalid or expired refresh token'
          : 'refresh token not recognized';
        return res.status(401).json({ error: msg });
      }

      const userId = rotated.userId;
      const [urows] = await pool.query('SELECT email FROM users WHERE id = ? LIMIT 1', [userId]);
      if (!urows || !urows.length) return res.status(404).json({ error: 'user not found' });
      const email = urows[0].email;

      const token = signAccessToken({ userId, email });
      return res.json({ ok: true, token, refreshToken: rotated.refreshToken });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET);
    } catch (e) {
      return res
        .status(401)
        .json({ error: "invalid or expired refresh token" });
    }

    const userId = payload.userId;
    const email = payload.email;
    const presentedJti = payload && payload.jti ? String(payload.jti) : null;

    // Match token.
    let matched = null;
    if (presentedJti && typeof pool.getConnection === 'function') {
      try {
        const [rows] = await pool.query(
          'SELECT id, token, jti FROM refresh_tokens WHERE user_id = ? AND jti = ? LIMIT 1',
          [userId, presentedJti]
        );
        if (rows && rows.length) {
          const ok = await bcrypt.compare(refreshToken, rows[0].token);
          if (ok) matched = rows[0];
        }
      } catch (e) {
        // If jti column/index isn't present for any reason, fall back to scan.
        try { logError(e); } catch (_) {}
      }
    }

    if (!matched) {
      // Fallback: scan all stored tokens for this user.
      const [rows] = await pool.query(
        'SELECT id, token FROM refresh_tokens WHERE user_id = ?',
        [userId]
      );
      for (const r of rows) {
        try {
          if (await bcrypt.compare(refreshToken, r.token)) {
            matched = r;
            break;
          }
        } catch (e) {
          logError(e);
        }
      }
    }

    if (!matched) {
      // Reuse detection: a valid refresh token that isn't in DB is suspicious.
      // Defensive response: revoke all refresh tokens for this user.
      try {
        await revokeAllRefreshForUser(userId);
      } catch (_) {
        await revokeAllRefreshTokensForUser(userId);
      }
      return res.status(401).json({ error: 'refresh token not recognized' });
    }

    const token = signAccessToken({ userId, email });
    const newJti = uuidv4();
    const newRefresh = signRefreshToken({ userId, email, jti: newJti });
    const newRefreshHash = await bcrypt.hash(newRefresh, 12);

    // Rotate refresh token.
    if (typeof pool.getConnection === 'function') {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query('DELETE FROM refresh_tokens WHERE id = ?', [matched.id]);
        await conn.query(
          'INSERT INTO refresh_tokens (user_id, token, jti) VALUES (?, ?, ?)',
          [userId, newRefreshHash, newJti]
        );
        await conn.commit();
      } catch (dbErr) {
        try { await conn.rollback(); } catch (_) {}
        logError(dbErr);
        return res.status(500).json({ error: 'failed to rotate refresh token' });
      } finally {
        try { conn.release(); } catch (_) {}
      }
    } else {
      try {
        await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [matched.id]);
        await pool.query(
          'INSERT INTO refresh_tokens (user_id, token) VALUES (?, ?)',
          [userId, newRefreshHash]
        );
      } catch (dbErr) {
        logError(dbErr);
        return res.status(500).json({ error: 'failed to rotate refresh token' });
      }
    }

    res.json({ ok: true, token, refreshToken: newRefresh });
}));

authRouter.post("/logout", loginLimiter, asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
      return res.status(400).json({ error: "refreshToken required" });

    // Opaque refresh session path.
    if (parseOpaqueRefreshToken(refreshToken)) {
      const deviceId = req.get('x-device-id') || null;
      if (NODE_ENV === 'production' && !deviceId) {
        return res.status(400).json({ error: 'missing x-device-id' });
      }
      const userAgent = req.get('user-agent') || '';
      const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();

      let verified;
      try {
        verified = await verifyRefreshSession({ refreshToken, deviceId, userAgent, ip });
      } catch (e) {
        try { logError(e); } catch (_) {}
        return res.status(500).json({ error: 'failed to revoke refresh token' });
      }

      if (!verified || !verified.ok) {
        if (verified && verified.reason === 'expired') {
          return res.status(401).json({ error: 'invalid or expired refresh token' });
        }
        return res.status(400).json({ error: 'refresh token not found' });
      }

      try {
        await revokeRefreshSession({ tokenId: verified.tokenId });
      } catch (e) {
        try { logError(e); } catch (_) {}
        return res.status(500).json({ error: 'failed to revoke refresh token' });
      }

      // Best-effort: unregister all push tokens for this user on logout.
      try {
        await deleteAllUserTokens(verified.userId);
      } catch (_) {}
      return res.json({ ok: true, message: 'logged out' });
    }

    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET);
    } catch (e) {
      return res
        .status(401)
        .json({ error: "invalid or expired refresh token" });
    }

    const userId = payload.userId;
    const presentedJti = payload && payload.jti ? String(payload.jti) : null;

    let deleted = false;
    if (presentedJti && typeof pool.getConnection === 'function') {
      try {
        const [rows] = await pool.query(
          'SELECT id, token FROM refresh_tokens WHERE user_id = ? AND jti = ? LIMIT 1',
          [userId, presentedJti]
        );
        if (rows && rows.length && (await bcrypt.compare(refreshToken, rows[0].token))) {
          await pool.query('DELETE FROM refresh_tokens WHERE id = ?', [rows[0].id]);
          deleted = true;
        }
      } catch (e) {
        try { logError(e); } catch (_) {}
      }
    }

    if (!deleted) {
      const [rows] = await pool.query(
        "SELECT id, token FROM refresh_tokens WHERE user_id = ?",
        [userId]
      );
      for (const r of rows) {
        try {
          if (await bcrypt.compare(refreshToken, r.token)) {
            await pool.query("DELETE FROM refresh_tokens WHERE id = ?", [r.id]);
            deleted = true;
            break;
          }
        } catch (e) {
          logError(e);
        }
      }
    }

    if (!deleted)
      return res.status(400).json({ error: "refresh token not found" });

    // Best-effort: unregister all push tokens for this user on logout.
    try {
      await deleteAllUserTokens(userId);
    } catch (_) {}

    res.json({ ok: true, message: "logged out" });
}));

authRouter.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.userId;
    const [rows] = await pool.query(
      "SELECT id, email, public_key, encrypted_private_key, mac, nonce, salt, iv, created_at FROM users WHERE id = ?",
      [userId]
    );
    if (!rows.length) return res.status(404).json({ error: "user not found" });
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    logError(err);
    res.status(500).json({ error: "internal server error" });
  }
});

module.exports = authRouter;
