const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const admin = require('../../infra/firebase/admin');
const { getPool } = require('../../infra/db');
const { logError } = require('../../infra/logging/logger');

const { DB_DRIVER = 'mysql', JWT_REFRESH_EXPIRES_IN = '7d' } = process.env;

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

async function revokeAllRefreshForUserFirebase(userId) {
  const firestore = admin.firestore();
  const now = new Date();

  // refresh_sessions
  try {
    const snap = await firestore.collection('refresh_sessions').where('user_id', '==', Number(userId)).get();
    if (!snap.empty) {
      const batch = firestore.batch();
      snap.docs.forEach((d) => batch.update(d.ref, { revoked_at: now }));
      await batch.commit();
    }
  } catch (e) {
    try { logError(e); } catch (_) {}
  }

  // legacy refresh_tokens
  try {
    const snap = await firestore.collection('refresh_tokens').where('user_id', '==', Number(userId)).get();
    if (!snap.empty) {
      const batch = firestore.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } catch (e) {
    try { logError(e); } catch (_) {}
  }
}

async function revokeAllRefreshForUser(userId, { conn } = {}) {
  if (DB_DRIVER.toLowerCase() === 'firebase') {
    await revokeAllRefreshForUserFirebase(userId);
    return;
  }

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

  if (DB_DRIVER.toLowerCase() === 'firebase') {
    const firestore = admin.firestore();
    await firestore.collection('refresh_sessions').doc(tokenId).set({
      user_id: Number(userId),
      token_id: tokenId,
      token_hash: tokenHash,
      device_id,
      user_agent_hash,
      ip_hash,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      expires_at: expiresAt,
      revoked_at: null,
      replaced_by_token_id: null,
    });
    return { refreshToken, tokenId, expiresAt };
  }

  const pool = getPool();
  await pool.query(
    'INSERT INTO refresh_sessions (user_id, token_id, token_hash, device_id, user_agent_hash, ip_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [userId, tokenId, tokenHash, device_id, user_agent_hash, ip_hash, expiresAt]
  );

  return { refreshToken, tokenId, expiresAt };
}

async function findRefreshSessionById({ tokenId }) {
  if (DB_DRIVER.toLowerCase() === 'firebase') {
    const doc = await admin.firestore().collection('refresh_sessions').doc(String(tokenId)).get();
    if (!doc.exists) return null;
    const d = doc.data() || {};
    return {
      token_id: d.token_id,
      user_id: d.user_id,
      token_hash: d.token_hash,
      device_id: d.device_id || null,
      expires_at: d.expires_at instanceof Date ? d.expires_at : d.expires_at?.toDate?.() || d.expires_at,
      revoked_at: d.revoked_at instanceof Date ? d.revoked_at : d.revoked_at?.toDate?.() || d.revoked_at,
      replaced_by_token_id: d.replaced_by_token_id || null,
    };
  }

  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT user_id, token_id, token_hash, device_id, expires_at, revoked_at, replaced_by_token_id FROM refresh_sessions WHERE token_id = ? LIMIT 1',
    [tokenId]
  );
  return rows && rows.length ? rows[0] : null;
}

async function revokeRefreshSession({ tokenId }) {
  if (DB_DRIVER.toLowerCase() === 'firebase') {
    const ref = admin.firestore().collection('refresh_sessions').doc(String(tokenId));
    const snap = await ref.get();
    if (!snap.exists) return { found: false };
    await ref.update({ revoked_at: new Date() });
    return { found: true };
  }
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

  if (DB_DRIVER.toLowerCase() === 'firebase') {
    const firestore = admin.firestore();
    const refOld = firestore.collection('refresh_sessions').doc(String(tokenId));
    const refNew = firestore.collection('refresh_sessions').doc(String(newTokenId));
    await firestore.runTransaction(async (t) => {
      const snap = await t.get(refOld);
      if (!snap.exists) throw new Error('refresh session missing');
      const d = snap.data() || {};
      if (d.revoked_at || d.replaced_by_token_id) throw new Error('refresh session already used');
      t.update(refOld, { revoked_at: now, replaced_by_token_id: newTokenId });
      t.set(refNew, {
        user_id: Number(row.user_id),
        token_id: newTokenId,
        token_hash: newHash,
        device_id,
        user_agent_hash,
        ip_hash,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        expires_at: newExpiresAt,
        revoked_at: null,
        replaced_by_token_id: null,
      });
    });

    return { ok: true, userId: row.user_id, refreshToken: newRefreshToken };
  }

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
