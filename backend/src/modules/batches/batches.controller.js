const asyncHandler = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/respond');
const service = require('./batches.service');
exports.list = asyncHandler(async (req, res) => ok(res, await service.list(req.user, req.query)));
exports.create = asyncHandler(async (req, res) => created(res, await service.create(req.user, req.body)));
exports.update = asyncHandler(async (req, res) => ok(res, await service.update(req.user, req.params.batchId, req.body), 'Batch updated'));
exports.students = asyncHandler(async (req, res) => ok(res, await service.listStudents(req.params.batchId)));
exports.assignTrainer = asyncHandler(async (req, res) => created(res, await service.assignTrainer(req.user, req.params.batchId, req.body), 'Trainer assigned'));
exports.removeTrainer = asyncHandler(async (req, res) => {
  await service.removeTrainer(req.user, req.params.batchId, req.params.trainerId);
  return ok(res, null, 'Trainer removed');
});
