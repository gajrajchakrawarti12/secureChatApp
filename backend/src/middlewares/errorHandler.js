const { logError } = require('../infra/logging/logger');
const { AppError } = require('../utils/appError');
const { sendFailure } = require('../utils/response');
const { httpStatus } = require('../utils/httpStatus');

function notFound(req, res) {
  return sendFailure(res, { status: httpStatus.NOT_FOUND, message: 'not found', data: {} });
}

function errorHandler(err, req, res, next) {
  try {
    logError(err);
  } catch (_) {}

  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return sendFailure(res, {
      status: err.status,
      message: err.message,
      data: err.details ? { details: err.details, code: err.code } : { code: err.code },
    });
  }

  // Avoid leaking stack traces to clients.
  return sendFailure(res, {
    status: httpStatus.INTERNAL_SERVER_ERROR,
    message: 'internal server error',
    data: { code: 'INTERNAL_ERROR' },
  });
}

module.exports = { notFound, errorHandler };
