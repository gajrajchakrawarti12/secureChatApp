const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { getPool } = require('../../infra/db');
const { logError } = require('../../infra/logging/logger');

const { JWT_REFRESH_EXPIRES_IN = '7d' } = process.env;

function base64url(buf) {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function sha256Hex(s) {
  if (!s) return null;
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function parseDurationToMs(v) {
  const s = String(v || '').trim();
  const m = s.match(/^([0-9]+)\s*([smhdw])$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const mult =
    unit === 's'
      ? 1000
      : unit === 'm'
        ? 60_000
        : unit === 'h'
          ? 3_600_000
          : unit === 'd'
            ? 86_400_000
            : 604_800_000;
  return n * mult;
}

function computeExpiryDate() {
  const ms = parseDurationToMs(JWT_REFRESH_EXPIRES_IN) || 7 * 86_400_000;
  // Guardrails: min 5 minutes, max 365 days.
  const bounded = Math.min(Math.max(ms, 5 * 60_000), 365 * 86_400_000);
  return new Date(Date.now() + bounded);
}

function buildOpaqueRefreshToken({ tokenId, secret }) {
  // Opaque, non-JWT refresh token.
  // Format: rt.<uuid>.<secret>
  return `rt.${tokenId}.${secret}`;
}

function parseOpaqueRefreshToken(token) {
  if (typeof token !== 'string') return null;
  if (!token.startsWith('rt.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const tokenId = parts[1];
  const secret = parts[2];
  if (!tokenId || !secret) return null;
  return { tokenId, secret };
}

async function revokeAllRefreshForUserMySql(conn, userId) {
  const now = new Date();
  await conn.query('UPDATE refresh_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, userId]);
  await conn.query('DELETE FROM refresh_tokens WHERE user_id = ?', [userId]);
}

async function revokeAllRefreshForUser(userId, { conn } = {}) {
  const pool = getPool();
  if (conn) {
    await revokeAllRefreshForUserMySql(conn, userId);
    return;
  }

  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    await revokeAllRefreshForUserMySql(c, userId);
    await c.commit();
  } catch (e) {
    try { await c.rollback(); } catch (_) {}
    throw e;
  } finally {
    try { c.release(); } catch (_) {}
  }
}

async function issueRefreshSession({ userId, deviceId, userAgent, ip }) {
  const tokenId = uuidv4();
  const secret = base64url(crypto.randomBytes(32));
  const refreshToken = buildOpaqueRefreshToken({ tokenId, secret });
  const tokenHash = await bcrypt.hash(secret, 12);
  const expiresAt = computeExpiryDate();

  const device_id = deviceId ? String(deviceId).slice(0, 128) : null;
  const { NODE_ENV = 'development' } = process.env;
  if (NODE_ENV === 'production' && !device_id) {
    throw new Error('missing device id');
  }
  const user_agent_hash = sha256Hex(userAgent);
  const ip_hash = sha256Hex(ip);

  const pool = getPool();
  await pool.query(
    'INSERT INTO refresh_sessions (user_id, token_id, token_hash, device_id, user_agent_hash, ip_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, tokenId, tokenHash, device_id, user_agent_hash, ip_hash, expiresAt]
  );

  return { refreshToken, tokenId, expiresAt };
}

async function findRefreshSessionById({ tokenId }) {
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT user_id, token_id, token_hash, device_id, expires_at, revoked_at, replaced_by_token_id FROM refresh_sessions WHERE token_id = ? LIMIT 1',
    [tokenId]
  );
  return rows && rows.length ? rows[0] : null;
}

async function revokeRefreshSession({ tokenId }) {
  const pool = getPool();
  const [res] = await pool.query('UPDATE refresh_sessions SET revoked_at = ? WHERE token_id = ?', [new Date(), tokenId]);
  return { found: !!(res && res.affectedRows) };
}

async function verifyRefreshSession({ refreshToken, deviceId, userAgent, ip }) {
  const parsed = parseOpaqueRefreshToken(refreshToken);
  if (!parsed) return { ok: false, reason: 'not-opaque' };

  const { tokenId, secret } = parsed;
  const row = await findRefreshSessionById({ tokenId });
  if (!row) return { ok: false, reason: 'not-found' };

  const now = new Date();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const revokedAt = row.revoked_at ? new Date(row.revoked_at) : null;

  if (expiresAt && now > expiresAt) {
    try { await revokeAllRefreshForUser(row.user_id); } catch (_) {}
    return { ok: false, reason: 'expired', userId: row.user_id, tokenId };
  }
  if (revokedAt || row.replaced_by_token_id) {
    try { await revokeAllRefreshForUser(row.user_id); } catch (_) {}
    return { ok: false, reason: 'reused', userId: row.user_id, tokenId };
  }

  const presentedDeviceId = deviceId ? String(deviceId).slice(0, 128) : null;
  if (row.device_id && (!presentedDeviceId || presentedDeviceId !== String(row.device_id))) {
    try { await revokeAllRefreshForUser(row.user_id); } catch (_) {}
    return { ok: false, reason: 'device-mismatch', userId: row.user_id, tokenId };
  }

  const ok = await bcrypt.compare(secret, row.token_hash);
  if (!ok) {
    try { await revokeAllRefreshForUser(row.user_id); } catch (_) {}
    return { ok: false, reason: 'mismatch', userId: row.user_id, tokenId };
  }

  return { ok: true, userId: row.user_id, tokenId, userAgentHash: sha256Hex(userAgent), ipHash: sha256Hex(ip) };
}

async function rotateRefreshSession({ refreshToken, deviceId, userAgent, ip }) {
  const parsed = parseOpaqueRefreshToken(refreshToken);
  if (!parsed) return { ok: false, reason: 'not-opaque' };

  const { tokenId, secret } = parsed;
  const row = await findRefreshSessionById({ tokenId });
  if (!row) return { ok: false, reason: 'not-found' };

  const now = new Date();
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  const revokedAt = row.revoked_at ? new Date(row.revoked_at) : null;

  // Hard expiry enforcement.
  if (expiresAt && now > expiresAt) {
    try {
      await revokeAllRefreshForUser(row.user_id);
    } catch (e) {
      try { logError(e); } catch (_) {}
    }
    return { ok: false, reason: 'expired', userId: row.user_id };
  }

  // Reuse detection: already revoked/replaced means token was already used.
  if (revokedAt || row.replaced_by_token_id) {
    try {
      await revokeAllRefreshForUser(row.user_id);
    } catch (e) {
      try { logError(e); } catch (_) {}
    }
    return { ok: false, reason: 'reused', userId: row.user_id };
  }

  // Device binding: require a matching device id when the session is bound.
  const presentedDeviceId = deviceId ? String(deviceId).slice(0, 128) : null;
  if (row.device_id && (!presentedDeviceId || presentedDeviceId !== String(row.device_id))) {
    try {
      await revokeAllRefreshForUser(row.user_id);
    } catch (e) {
      try { logError(e); } catch (_) {}
    }
    return { ok: false, reason: 'device-mismatch', userId: row.user_id };
  }

  const ok = await bcrypt.compare(secret, row.token_hash);
  if (!ok) {
    // Token ID exists but secret mismatch: treat as theft/replay attempt → revoke all.
    try {
      await revokeAllRefreshForUser(row.user_id);
    } catch (e) {
      try { logError(e); } catch (_) {}
    }
    return { ok: false, reason: 'mismatch', userId: row.user_id };
  }

  // Issue replacement.
  const newTokenId = uuidv4();
  const newSecret = base64url(crypto.randomBytes(32));
  const newRefreshToken = buildOpaqueRefreshToken({ tokenId: newTokenId, secret: newSecret });
  const newHash = await bcrypt.hash(newSecret, 12);
  const newExpiresAt = computeExpiryDate();

  const device_id = presentedDeviceId || (row.device_id ? String(row.device_id) : null);
  const user_agent_hash = sha256Hex(userAgent);
  const ip_hash = sha256Hex(ip);

  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Lock the row.
    const [locked] = await conn.query(
      'SELECT user_id, token_id, token_hash, device_id, expires_at, revoked_at, replaced_by_token_id FROM refresh_sessions WHERE token_id = ? FOR UPDATE',
      [tokenId]
    );
    if (!locked || !locked.length) {
      await conn.rollback();
      return { ok: false, reason: 'not-found' };
    }
    const lr = locked[0];
    if (lr.revoked_at || lr.replaced_by_token_id) {
      await revokeAllRefreshForUserMySql(conn, lr.user_id);
      await conn.commit();
      return { ok: false, reason: 'reused', userId: lr.user_id };
    }

    await conn.query(
      'UPDATE refresh_sessions SET revoked_at = ?, replaced_by_token_id = ? WHERE token_id = ?',
      [now, newTokenId, tokenId]
    );
    await conn.query(
      'INSERT INTO refresh_sessions (user_id, token_id, token_hash, device_id, user_agent_hash, ip_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [row.user_id, newTokenId, newHash, device_id, user_agent_hash, ip_hash, newExpiresAt]
    );

    await conn.commit();
    return { ok: true, userId: row.user_id, refreshToken: newRefreshToken };
  } catch (e) {
    try { await conn.rollback(); } catch (_) {}
    throw e;
  } finally {
    try { conn.release(); } catch (_) {}
  }
}

module.exports = {
  parseOpaqueRefreshToken,
  issueRefreshSession,
  verifyRefreshSession,
  rotateRefreshSession,
  revokeRefreshSession,
  revokeAllRefreshForUser,
};
