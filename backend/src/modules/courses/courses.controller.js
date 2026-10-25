const asyncHandler = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/respond');
const service = require('./courses.service');
exports.list = asyncHandler(async (req, res) => ok(res, await service.list(req.user)));
exports.listPublic = asyncHandler(async (req, res) => ok(res, await service.listPublic()));
exports.listActive = asyncHandler(async (req, res) => ok(res, await service.listActive()));
exports.getPublic = asyncHandler(async (req, res) => ok(res, await service.getPublicBySlug(req.params.slug)));
exports.details = asyncHandler(async (req, res) => ok(res, await service.getDetails(req.params.courseId, req.user)));
exports.groupedStudents = asyncHandler(async (req, res) => ok(res, await service.listGroupedStudents(req.query.search)));
exports.requestedStudents = asyncHandler(async (req, res) => ok(res, await service.listRequestedStudents(req.query.search)));
exports.create = asyncHandler(async (req, res) => created(res, await service.create(req.user, req.body)));
exports.update = asyncHandler(async (req, res) => ok(res, await service.update(req.user, req.params.courseId, req.body), 'Course updated'));
exports.enrollRequested = asyncHandler(async (req, res) => ok(res, await service.enrollRequestedStudents(req.user, req.params.courseId, req.body.requestedCourseName), 'Requested students enrolled'));
exports.assignTrainer = asyncHandler(async (req, res) => {
  const result = await service.assignTrainer(req.user, req.params.courseId, req.body.email);
  if (result.alreadyAssigned) return ok(res, result, 'Trainer is already assigned');
  return created(res, result, 'Trainer assigned');
});
exports.removeTrainer = asyncHandler(async (req, res) => {
  await service.removeTrainer(req.user, req.params.courseId, req.params.trainerId);
  return ok(res, null, 'Trainer removed');
});
