const asyncHandler = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/respond');
const sessions = require('./session.service');
const { checkIn } = require('./checkin.service');
const { correctRecord } = require('./correction.service');
const { myHistory } = require('./history.service');

exports.start = asyncHandler(async (req, res) => created(res, await sessions.startSession(req.user, req.params.batchId, req.body), 'Attendance session started'));
exports.listForBatch = asyncHandler(async (req, res) => ok(res, await sessions.listForBatch(req.user, req.params.batchId)));
exports.get = asyncHandler(async (req, res) => ok(res, await sessions.getSession(req.user, req.params.sessionId)));
exports.rotate = asyncHandler(async (req, res) => ok(res, await sessions.rotateToken(req.user, req.params.sessionId), 'QR token rotated'));
exports.close = asyncHandler(async (req, res) => {
  const { session, absentCreated, counts } = await sessions.closeSession(req.user, req.params.sessionId);
  return ok(res, { session, absentCreated, counts }, 'Session closed');
});
exports.cancel = asyncHandler(async (req, res) => ok(res, await sessions.cancelSession(req.user, req.params.sessionId, req.body.reason), 'Session cancelled'));
exports.records = asyncHandler(async (req, res) => ok(res, await sessions.listRecords(req.user, req.params.sessionId)));
exports.checkIn = asyncHandler(async (req, res) => created(res, await checkIn(req.user, req.body), 'Attendance recorded'));
exports.correct = asyncHandler(async (req, res) => ok(res, await correctRecord(req.user, req.params.recordId, req.body), 'Attendance corrected'));
exports.myHistory = asyncHandler(async (req, res) => ok(res, await myHistory(req.user)));
