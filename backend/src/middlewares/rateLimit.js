const { sendFailure } = require('../utils/response');
const { httpStatus } = require('../utils/httpStatus');

// Minimal in-memory rate limiter. Suitable for single-instance deployments only.
// For multi-instance production, replace with a shared-store limiter.
function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map();

  return function rateLimitMiddleware(req, res, next) {
    const now = Date.now();
    const key = (keyFn ? keyFn(req) : req.ip) || 'unknown';

    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      return sendFailure(res, { status: httpStatus.TOO_MANY_REQUESTS, message: 'too many requests', data: {} });
    }

    return next();
  };
}

module.exports = { rateLimit };
