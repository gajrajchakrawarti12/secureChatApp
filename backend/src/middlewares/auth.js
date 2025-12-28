const jwt = require('jsonwebtoken');
const { AppError } = require('../utils/appError');
const { httpStatus } = require('../utils/httpStatus');

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return next(new AppError('missing authorization header', { status: httpStatus.UNAUTHORIZED, code: 'AUTH_MISSING' }));

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || String(parts[0]).toLowerCase() !== 'bearer') {
    return next(new AppError('invalid authorization format', { status: httpStatus.UNAUTHORIZED, code: 'AUTH_INVALID_FORMAT' }));
  }

  const token = parts[1];
  const secret = process.env.JWT_SECRET;
  if (!secret || String(secret).trim().length < 32) {
    // Fail-fast: auth cannot function securely without a strong secret.
    return next(new AppError('server misconfigured: JWT_SECRET missing/weak', { status: httpStatus.INTERNAL_SERVER_ERROR, code: 'SERVER_MISCONFIG' }));
  }

  try {
    const payload = jwt.verify(token, secret);
    req.user = payload;
    return next();
  } catch (e) {
    return next(new AppError('invalid or expired token', { status: httpStatus.UNAUTHORIZED, code: 'AUTH_INVALID_TOKEN' }));
  }
}

module.exports = { auth };
