function getEnv(name, fallback) {
  const val = process.env[name];
  if (val === undefined || val === null || String(val).trim() === '') return fallback;
  return val;
}

function requireStrongJwtSecret() {
  const jwtSecret = getEnv('JWT_SECRET', 'changeme');
  const nodeEnv = getEnv('NODE_ENV', 'development');

  // Fail fast only in production to avoid breaking local dev unexpectedly.
  if (nodeEnv === 'production' && (jwtSecret === 'changeme' || jwtSecret.length < 32)) {
    throw new Error('Invalid JWT_SECRET. In production, set JWT_SECRET to a strong secret (>= 32 chars) and do not use the default.');
  }
}

module.exports = { getEnv, requireStrongJwtSecret };
