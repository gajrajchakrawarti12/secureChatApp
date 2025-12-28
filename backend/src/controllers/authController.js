const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');
const { httpStatus } = require('../utils/httpStatus');

async function register(req, res) {
  const result = await authService.register(req.body);
  return sendSuccess(res, { status: httpStatus.CREATED, message: 'registration successful', data: result });
}

async function login(req, res) {
  const deviceId = req.get('x-device-id') || null;
  const userAgent = req.get('user-agent') || '';
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();

  const result = await authService.login({ ...req.body, deviceId, userAgent, ip });
  return sendSuccess(res, { message: 'login successful', data: result });
}

async function refresh(req, res) {
  const deviceId = req.get('x-device-id') || null;
  const userAgent = req.get('user-agent') || '';
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();

  const result = await authService.refresh({ ...req.body, deviceId, userAgent, ip });
  return sendSuccess(res, { message: 'token refreshed', data: result });
}

async function logout(req, res) {
  const deviceId = req.get('x-device-id') || null;
  const userAgent = req.get('user-agent') || '';
  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString();

  const result = await authService.logout({ ...req.body, deviceId, userAgent, ip });
  return sendSuccess(res, { message: result.message, data: {} });
}

async function me(req, res) {
  const user = await authService.me({ userId: req.user.userId });
  return sendSuccess(res, { message: 'ok', data: { user } });
}

module.exports = { register, login, refresh, logout, me };
