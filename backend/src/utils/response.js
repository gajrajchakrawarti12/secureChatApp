const { httpStatus } = require('./httpStatus');

function sendSuccess(res, { status = httpStatus.OK, message = 'ok', data = {} } = {}) {
  return res.status(status).json({ success: true, message, data });
}

function sendFailure(res, { status = httpStatus.INTERNAL_SERVER_ERROR, message = 'error', data = {} } = {}) {
  return res.status(status).json({ success: false, message, data });
}

module.exports = { sendSuccess, sendFailure };
