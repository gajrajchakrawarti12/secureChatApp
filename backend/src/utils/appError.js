const { httpStatus } = require('./httpStatus');

class AppError extends Error {
  constructor(message, { status = httpStatus.INTERNAL_SERVER_ERROR, code = 'INTERNAL_ERROR', details = undefined } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

module.exports = { AppError };
