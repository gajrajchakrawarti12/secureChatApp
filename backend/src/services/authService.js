const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const usersRepository = require('../repositories/usersRepository');
const legacyRefreshTokensRepository = require('../repositories/legacyRefreshTokensRepository');
const refreshSessionsRepository = require('../repositories/refreshSessionsRepository');

const { AppError } = require('../utils/appError');
const { httpStatus } = require('../utils/httpStatus');

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || String(secret).trim().length < 32) {
    throw new AppError('server misconfigured: JWT_SECRET missing/weak', {
      status: httpStatus.INTERNAL_SERVER_ERROR,
      code: 'SERVER_MISCONFIG',
    });
  }
  return secret;
}

function signAccessToken({ userId, email }) {
  const secret = getJwtSecret();
  const expiresIn = process.env.JWT_EXPIRES_IN || '1h';
  return jwt.sign({ userId, email }, secret, { expiresIn });
}

function signLegacyRefreshToken({ userId, email, jti }) {
  const secret = getJwtSecret();
  const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
  const payload = jti ? { userId, email, jti } : { userId, email };
  return jwt.sign(payload, secret, { expiresIn });
}

async function register({ email, password, publicKey, encryptedPrivateKey, mac, nonce, salt, iv }) {
  const normalizedEmail = String(email).trim().toLowerCase();

  const existing = await usersRepository.findByEmail(normalizedEmail);
  if (existing) {
    throw new AppError('email already registered', { status: httpStatus.CONFLICT, code: 'EMAIL_EXISTS' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await usersRepository.createUser({
    email: normalizedEmail,
    passwordHash,
    publicKey,
    encryptedPrivateKey,
    mac,
    nonce,
    salt,
    iv,
  });

  return { email: normalizedEmail };
}

async function login({ email, password, deviceId, userAgent, ip }) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await usersRepository.findByEmail(normalizedEmail);
  if (!user) {
    throw new AppError('invalid credentials', { status: httpStatus.UNAUTHORIZED, code: 'INVALID_CREDENTIALS' });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    throw new AppError('invalid credentials', { status: httpStatus.UNAUTHORIZED, code: 'INVALID_CREDENTIALS' });
  }

  const token = signAccessToken({ userId: user.id, email: normalizedEmail });

  const { NODE_ENV = 'development' } = process.env;
  if (NODE_ENV === 'production' && !deviceId) {
    throw new AppError('missing x-device-id', { status: httpStatus.BAD_REQUEST, code: 'DEVICE_ID_REQUIRED' });
  }

  // Prefer opaque refresh sessions.
  let refreshToken;
  try {
    const issued = await refreshSessionsRepository.issueRefreshSession({
      userId: user.id,
      deviceId: deviceId || null,
      userAgent: userAgent || '',
      ip: ip || '',
    });
    refreshToken = issued.refreshToken;
  } catch (_) {
    // Fall back to legacy JWT refresh.
    const jti = uuidv4();
    const legacyRefresh = signLegacyRefreshToken({ userId: user.id, email: normalizedEmail, jti });
    const legacyHash = await bcrypt.hash(legacyRefresh, 12);
    await legacyRefreshTokensRepository.insertToken({ userId: user.id, tokenHash: legacyHash, jti });
    refreshToken = legacyRefresh;
  }

  return { token, refreshToken, salt: user.salt };
}

async function refresh({ refreshToken, deviceId, userAgent, ip }) {
  if (refreshSessionsRepository.parseOpaqueRefreshToken(refreshToken)) {
    const { NODE_ENV = 'development' } = process.env;
    if (NODE_ENV === 'production' && !deviceId) {
      throw new AppError('missing x-device-id', { status: httpStatus.BAD_REQUEST, code: 'DEVICE_ID_REQUIRED' });
    }

    const rotated = await refreshSessionsRepository.rotateRefreshSession({ refreshToken, deviceId: deviceId || null, userAgent: userAgent || '', ip: ip || '' });

    if (!rotated || !rotated.ok) {
      const msg = rotated && rotated.reason === 'expired' ? 'invalid or expired refresh token' : 'refresh token not recognized';
      throw new AppError(msg, { status: httpStatus.UNAUTHORIZED, code: 'REFRESH_INVALID' });
    }

    const user = await usersRepository.findById(rotated.userId);
    if (!user) throw new AppError('user not found', { status: httpStatus.NOT_FOUND, code: 'USER_NOT_FOUND' });

    const token = signAccessToken({ userId: user.id, email: user.email });
    return { token, refreshToken: rotated.refreshToken };
  }

  // Legacy JWT refresh
  let payload;
  try {
    payload = jwt.verify(refreshToken, getJwtSecret());
  } catch (_) {
    throw new AppError('invalid or expired refresh token', { status: httpStatus.UNAUTHORIZED, code: 'REFRESH_EXPIRED' });
  }

  const userId = payload.userId;
  const email = payload.email;
  const presentedJti = payload && payload.jti ? String(payload.jti) : null;

  let matched = null;
  if (presentedJti) {
    const row = await legacyRefreshTokensRepository.findTokenByUserAndJti({ userId, jti: presentedJti });
    if (row && (await bcrypt.compare(refreshToken, row.token))) matched = row;
  }

  if (!matched) {
    const rows = await legacyRefreshTokensRepository.listTokensForUser(userId);
    for (const r of rows) {
      if (await bcrypt.compare(refreshToken, r.token)) {
        matched = r;
        break;
      }
    }
  }

  if (!matched) {
    try {
      await refreshSessionsRepository.revokeAllRefreshForUser(userId);
    } catch (_) {
      await legacyRefreshTokensRepository.deleteAllForUser(userId);
    }
    throw new AppError('refresh token not recognized', { status: httpStatus.UNAUTHORIZED, code: 'REFRESH_NOT_FOUND' });
  }

  const token = signAccessToken({ userId, email });
  const newJti = uuidv4();
  const newRefresh = signLegacyRefreshToken({ userId, email, jti: newJti });
  const newRefreshHash = await bcrypt.hash(newRefresh, 12);

  await legacyRefreshTokensRepository.deleteTokenById(matched.id);
  await legacyRefreshTokensRepository.insertToken({ userId, tokenHash: newRefreshHash, jti: newJti });

  return { token, refreshToken: newRefresh };
}

async function logout({ refreshToken, deviceId, userAgent, ip }) {
  if (refreshSessionsRepository.parseOpaqueRefreshToken(refreshToken)) {
    const { NODE_ENV = 'development' } = process.env;
    if (NODE_ENV === 'production' && !deviceId) {
      throw new AppError('missing x-device-id', { status: httpStatus.BAD_REQUEST, code: 'DEVICE_ID_REQUIRED' });
    }

    const verified = await refreshSessionsRepository.verifyRefreshSession({ refreshToken, deviceId: deviceId || null, userAgent: userAgent || '', ip: ip || '' });
    if (!verified || !verified.ok) {
      if (verified && verified.reason === 'expired') {
        throw new AppError('invalid or expired refresh token', { status: httpStatus.UNAUTHORIZED, code: 'REFRESH_EXPIRED' });
      }
      throw new AppError('refresh token not found', { status: httpStatus.BAD_REQUEST, code: 'REFRESH_NOT_FOUND' });
    }

    await refreshSessionsRepository.revokeRefreshSession({ tokenId: verified.tokenId });
    return { message: 'logged out' };
  }

  let payload;
  try {
    payload = jwt.verify(refreshToken, getJwtSecret());
  } catch (_) {
    throw new AppError('invalid or expired refresh token', { status: httpStatus.UNAUTHORIZED, code: 'REFRESH_EXPIRED' });
  }

  const userId = payload.userId;
  const presentedJti = payload && payload.jti ? String(payload.jti) : null;

  let deleted = false;
  if (presentedJti) {
    const row = await legacyRefreshTokensRepository.findTokenByUserAndJti({ userId, jti: presentedJti });
    if (row && (await bcrypt.compare(refreshToken, row.token))) {
      await legacyRefreshTokensRepository.deleteTokenById(row.id);
      deleted = true;
    }
  }

  if (!deleted) {
    const rows = await legacyRefreshTokensRepository.listTokensForUser(userId);
    for (const r of rows) {
      if (await bcrypt.compare(refreshToken, r.token)) {
        await legacyRefreshTokensRepository.deleteTokenById(r.id);
        deleted = true;
        break;
      }
    }
  }

  if (!deleted) {
    throw new AppError('refresh token not found', { status: httpStatus.BAD_REQUEST, code: 'REFRESH_NOT_FOUND' });
  }

  return { message: 'logged out' };
}

async function me({ userId }) {
  const user = await usersRepository.findById(userId);
  if (!user) throw new AppError('user not found', { status: httpStatus.NOT_FOUND, code: 'USER_NOT_FOUND' });
  return user;
}

module.exports = { register, login, refresh, logout, me };
