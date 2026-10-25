const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const make = (windowMs, limit, code, keyByUser = false) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    ...(keyByUser ? { keyGenerator: (req) => (req.user ? `u:${req.user.id}` : req.ip) } : {}),
    handler: (req, res) =>
      res.status(429).json({ success: false, message: 'Too many requests, please slow down', error: { code } }),
  });

module.exports = {
  authLimiter: make(15 * 60 * 1000, 30, 'RATE_LIMIT_AUTH'),
  registerLimiter: make(60 * 60 * 1000, 10, 'RATE_LIMIT_REGISTER'),
  refreshLimiter: make(15 * 60 * 1000, 120, 'RATE_LIMIT_REFRESH'),
  qrRotateLimiter: make(60 * 1000, 20, 'RATE_LIMIT_QR_ROTATE', true),
  checkInLimiter: make(60 * 1000, 20, 'RATE_LIMIT_CHECKIN', true),
};
