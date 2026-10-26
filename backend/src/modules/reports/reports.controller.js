const asyncHandler = require('../../utils/asyncHandler');
const { ok } = require('../../utils/respond');
const service = require('./reports.service');
exports.report = asyncHandler(async (req, res) => ok(res, await service.report(req.user, req.query)));
exports.summary = asyncHandler(async (req, res) => ok(res, await service.summary(req.user, req.query)));
exports.overview = asyncHandler(async (req, res) => ok(res, await service.overview(req.user, req.query)));
exports.export = asyncHandler(async (req, res) => {
  const f = await service.exportReport(req.user, req.query);
  res.setHeader('Content-Type', f.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${f.filename}"`);
  res.send(f.body);
});
