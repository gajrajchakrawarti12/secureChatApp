// Minimal in-memory rate limiter. Suitable for single-instance deployments only.
// For multi-instance production, replace with Redis-backed limiter.

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
      return res.status(429).json({ error: 'too many requests' });
    }

    return next();
  };
}

module.exports = { rateLimit };
