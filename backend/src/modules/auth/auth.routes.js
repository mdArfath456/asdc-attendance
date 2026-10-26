const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { authLimiter, refreshLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('./auth.controller');
const v = require('./auth.validation');
const ApiError = require('../../utils/ApiError');
const { registerLimiter } = require('../../middleware/rateLimiters');
const env = require('../../config/env');

const requireTrustedOrigin = (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !env.clientOrigins.includes(origin)) {
    return next(new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
  }
  return next();
};

router.post('/register', registerLimiter, validate({ body: v.register }), ctrl.registerStudent);
router.post('/register-google', registerLimiter, validate({ body: v.registerGoogle }), ctrl.registerGoogleStudent);
router.post('/login', authLimiter, validate({ body: v.login }), ctrl.login);
router.post('/google', authLimiter, validate({ body: v.googleLogin }), ctrl.google);
router.post('/refresh', refreshLimiter, requireTrustedOrigin, ctrl.refresh);
router.post('/logout', requireTrustedOrigin, ctrl.logout);
router.get('/me', authenticate, ctrl.me);
module.exports = router;
