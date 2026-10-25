const ApiError = require('../../utils/ApiError');
const Batch = require('./batch.model');
const TrainerAssignment = require('./trainerAssignment.model');
const Course = require('../courses/course.model');
const User = require('../users/user.model');
const Enrollment = require('../enrollments/enrollment.model');
const audit = require('../audit/audit.service');

// Central server-side batch authorisation. Never trusts role/batch from the client.
async function assertBatchAccess(user, batchId, { manage = false } = {}) {
  const batch = await Batch.findById(batchId);
  if (!batch) throw new ApiError(404, 'BATCH_NOT_FOUND', 'Batch not found');
  if (user.role === 'ADMIN') return batch;
  if (user.role === 'TRAINER') {
    const a = await TrainerAssignment.findOne({ batchId: batch._id, trainerId: user.id });
    if (a && (!manage || a.canManageSessions)) return batch;
  }
  throw new ApiError(403, 'BATCH_FORBIDDEN', 'You are not authorised for this batch');
}

async function list(user, { courseId, status }) {
  const filter = {};
  if (courseId) filter.courseId = courseId;
  if (status) filter.status = status;
  let assignments = {};
  if (user.role === 'TRAINER') {
    const rows = await TrainerAssignment.find({ trainerId: user.id }).lean();
    filter._id = { $in: rows.map((r) => r.batchId) };
    assignments = Object.fromEntries(rows.map((r) => [String(r.batchId), r]));
  }
  filter.isCourseGroup = true;
  const batches = await Batch.find(filter).select('+isCourseGroup').sort({ startDate: -1 }).populate('courseId', 'name code').lean();
  return batches.map((b) => ({
    ...b,
    id: String(b._id),
    canManageSessions: user.role === 'TRAINER' ? !!(assignments[String(b._id)] || {}).canManageSessions : true,
  }));
}

async function create(actor, input) {
  const course = await Course.findById(input.courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  const batch = await Batch.create({ ...input, createdBy: actor.id });
  await audit.log({ actorId: actor.id, action: 'BATCH_CREATED', entityType: 'Batch', entityId: batch._id });
  return batch;
}

async function update(actor, batchId, input) {
  const batch = await Batch.findByIdAndUpdate(batchId, { $set: input }, { new: true, runValidators: true });
  if (!batch) throw new ApiError(404, 'BATCH_NOT_FOUND', 'Batch not found');
  await audit.log({ actorId: actor.id, action: 'BATCH_UPDATED', entityType: 'Batch', entityId: batch._id, metadata: { fields: Object.keys(input) } });
  return batch;
}

async function listStudents(batchId) {
  const rows = await Enrollment.find({ batchId, status: 'ACTIVE' }).populate('studentId', 'name email status').sort({ enrolledAt: 1 }).lean();
  return rows.map((e) => ({ enrollmentId: String(e._id), enrolledAt: e.enrolledAt, student: e.studentId && { id: String(e.studentId._id), name: e.studentId.name, email: e.studentId.email } }));
}

async function assignTrainer(actor, batchId, { trainerId, isPrimary = false, canManageSessions = false }) {
  const trainer = await User.findById(trainerId);
  if (!trainer || trainer.role !== 'TRAINER' || trainer.status !== 'ACTIVE') throw new ApiError(400, 'INVALID_TRAINER', 'User is not an active trainer');
  if (isPrimary) await TrainerAssignment.updateMany({ batchId, trainerId: { $ne: trainerId } }, { isPrimary: false });
  const doc = await TrainerAssignment.findOneAndUpdate(
    { batchId, trainerId },
    { $set: { isPrimary, canManageSessions, assignedBy: actor.id } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await audit.log({ actorId: actor.id, action: 'TRAINER_ASSIGNED', entityType: 'Batch', entityId: batchId, metadata: { trainerId, isPrimary, canManageSessions } });
  return doc;
}

async function removeTrainer(actor, batchId, trainerId) {
  const res = await TrainerAssignment.findOneAndDelete({ batchId, trainerId });
  if (!res) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Trainer is not assigned to this batch');
  await audit.log({ actorId: actor.id, action: 'TRAINER_REMOVED', entityType: 'Batch', entityId: batchId, metadata: { trainerId } });
}

module.exports = { assertBatchAccess, list, create, update, listStudents, assignTrainer, removeTrainer };
