function getEnv(name, fallback) {
  const val = process.env[name];
  if (val === undefined || val === null || String(val).trim() === '') return fallback;
  return val;
}

function requireStrongJwtSecret() {
  const jwtSecret = getEnv('JWT_SECRET');
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error('Invalid JWT_SECRET. Set JWT_SECRET to a strong secret (>= 32 chars).');
  }
}

module.exports = { getEnv, requireStrongJwtSecret };
