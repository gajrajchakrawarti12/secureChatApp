const { AppError } = require('../utils/appError');
const { httpStatus } = require('../utils/httpStatus');

function validate({ body, query, params, headers } = {}) {
  return function validateMiddleware(req, res, next) {
    try {
      if (body) req.body = body.parse(req.body);
      if (query) req.query = query.parse(req.query);
      if (params) req.params = params.parse(req.params);
      if (headers) req.headers = headers.parse(req.headers);
      return next();
    } catch (e) {
      return next(
        new AppError('validation failed', {
          status: httpStatus.BAD_REQUEST,
          code: 'VALIDATION_ERROR',
          details: e && e.errors ? e.errors : undefined,
        })
      );
    }
  };
}

module.exports = { validate };
