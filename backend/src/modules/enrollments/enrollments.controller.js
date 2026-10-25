const asyncHandler = require('../../utils/asyncHandler');
const { ok, created } = require('../../utils/respond');
const service = require('./enrollments.service');
exports.enroll = asyncHandler(async (req, res) => created(res, await service.enrollStudents(req.user, req.params.batchId, req.body.studentIds), 'Enrollment processed'));
exports.join = asyncHandler(async (req, res) => created(res, await service.joinCourse(req.user, req.body.courseId), 'Joined course'));
exports.requestCourse = asyncHandler(async (req, res) => created(res, await service.requestCourse(req.user, req.body.requestedCourseName), 'Course request sent'));
exports.status = asyncHandler(async (req, res) => ok(res, await service.updateStatus(req.user, req.params.enrollmentId, req.body), 'Enrollment updated'));
exports.transfer = asyncHandler(async (req, res) => ok(res, await service.transfer(req.user, req.params.enrollmentId, req.body), 'Enrollment transferred'));
