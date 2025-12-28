const jwt = require('jsonwebtoken');

const { JWT_SECRET = 'changeme' } = process.env;

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'missing authorization header' });
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || String(parts[0]).toLowerCase() !== 'bearer') {
    return res.status(401).json({ error: 'invalid authorization format' });
  }
  const token = parts[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid or expired token' });
  }
}

module.exports = { auth };
