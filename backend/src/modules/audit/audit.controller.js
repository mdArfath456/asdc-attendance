const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/respond');
const service = require('./audit.service');
exports.list = asyncHandler(async (req, res) => ok(res, await service.list(req.query)));
