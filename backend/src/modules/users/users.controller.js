const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/respond');
const service = require('./users.service');
exports.list = asyncHandler(async (req, res) => ok(res, await service.list(req.query)));
exports.setStatus = asyncHandler(async (req, res) => ok(res, await service.setStatus(req.user, req.params.userId, req.body), 'Status updated'));
exports.setPreferences = asyncHandler(async (req, res) => ok(res, await service.setPreferences(req.user, req.body), 'Preferences updated'));
