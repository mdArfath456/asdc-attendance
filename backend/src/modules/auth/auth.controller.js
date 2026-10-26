const env = require('../../config/env');
const asyncHandler = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/respond');
const usersService = require('../users/users.service');
const service = require('./auth.service');

const COOKIE = 'asdc_rt';
const cookieOptions = () => ({
  httpOnly: true,
  secure: env.isProd || env.COOKIE_SAMESITE === 'none',
  sameSite: env.COOKIE_SAMESITE,
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_DAYS * 86400000,
});
const ctxOf = (req) => ({ ip: req.ip, userAgent: req.headers['user-agent'] });
const sendSession = (res, { user, accessToken, refreshToken }, message) => {
  res.cookie(COOKIE, refreshToken, cookieOptions());
  return ok(res, { user, accessToken }, message);
};

exports.login = asyncHandler(async (req, res) => sendSession(res, await service.loginLocal(req.body, ctxOf(req)), 'Logged in'));
exports.google = asyncHandler(async (req, res) => sendSession(res, await service.loginWithGoogle(req.body.idToken, ctxOf(req), { adminOnly: req.body.adminOnly }), 'Logged in with Google'));
exports.registerStudent = asyncHandler(async (req, res) => created(res, await service.registerLocal(req.body, ctxOf(req)), 'Account created'));
exports.registerGoogleStudent = asyncHandler(async (req, res) => created(res, await service.registerGoogle(req.body, ctxOf(req)), 'Account created'));
exports.refresh = asyncHandler(async (req, res) => {
  try {
    return sendSession(res, await service.refresh(req.cookies[COOKIE], ctxOf(req)), 'Token refreshed');
  } catch (e) {
    const definitiveFailures = new Set([
      'NO_REFRESH_TOKEN',
      'INVALID_REFRESH_TOKEN',
      'REFRESH_TOKEN_EXPIRED',
      'REFRESH_TOKEN_REUSED',
      'UNAUTHENTICATED',
    ]);
    if (definitiveFailures.has(e.code)) {
      res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
    }
    throw e;
  }
});
exports.logout = asyncHandler(async (req, res) => {
  await service.logout(req.cookies[COOKIE]);
  res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  return ok(res, null, 'Logged out');
});
exports.me = asyncHandler(async (req, res) => ok(res, await usersService.getById(req.user.id)));
