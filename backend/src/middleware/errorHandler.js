const { ZodError } = require('zod');
const ApiError = require('../utils/ApiError');
const env = require('../config/env');

function notFound(req, res, next) {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details;

  if (err instanceof ApiError) {
    ({ status, code, message, details } = err);
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err && err.code === 11000) {
    status = 409;
    code = 'DUPLICATE_KEY';
    message = 'A record with the same unique value already exists';
    details = Object.keys(err.keyPattern || {});
  } else if (err && err.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid identifier format';
  } else if (err && err.name === 'ValidationError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    details = Object.values(err.errors || {}).map((e) => ({ path: e.path, message: e.message }));
  } else if (err && err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Malformed JSON body';
  }

  if (status >= 500 && !env.isTest) console.error('[error]', err && err.stack ? err.stack : err);
  res.status(status).json({ success: false, message, error: { code, details } });
}

module.exports = { notFound, errorHandler };
