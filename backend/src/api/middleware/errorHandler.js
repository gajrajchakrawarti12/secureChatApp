const { logError } = require('../../infra/logging/logger');

function notFound(req, res) {
  res.status(404).json({ error: 'not found' });
}

function errorHandler(err, req, res, next) {
  try {
    logError(err);
  } catch (_) {}

  if (res.headersSent) return next(err);

  // Avoid leaking internals to clients.
  res.status(500).json({ error: 'internal server error' });
}

module.exports = { notFound, errorHandler };
