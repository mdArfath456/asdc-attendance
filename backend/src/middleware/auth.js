const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const User = require('../modules/users/user.model');

// Verifies the access JWT, then re-checks the user's current role/status in the DB so that
// suspensions and role changes take effect immediately.
const authenticate = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'UNAUTHENTICATED', 'Authentication required');
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    throw new ApiError(401, e.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN', 'Invalid or expired access token');
  }
  const user = await User.findById(payload.sub).select('name email role status');
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'UNAUTHENTICATED', 'Account is not active');
  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
});

const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
  return next();
};

// Verifies access to :batchId (Admins: any; Trainers: assigned, and canManageSessions when manage=true).
const authorizeBatchAccess = ({ manage = false } = {}) =>
  asyncHandler(async (req, res, next) => {
    const { assertBatchAccess } = require('../modules/batches/batches.service');
    req.batch = await assertBatchAccess(req.user, req.params.batchId, { manage });
    next();
  });

module.exports = { authenticate, authorizeRoles, authorizeBatchAccess };
