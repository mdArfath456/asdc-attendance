const ApiError = require('../../utils/ApiError');
const Enrollment = require('./enrollment.model');
const Batch = require('../batches/batch.model');
const User = require('../users/user.model');
const audit = require('../audit/audit.service');
const { runInTransaction } = require('../../utils/transaction');
const Course = require('../courses/course.model');
const coursesService = require('../courses/courses.service');

async function joinCourse(user, courseId) {
  if (user.role !== 'STUDENT') throw new ApiError(403, 'STUDENT_ONLY', 'Only students can join a course');
  const course = await Course.findOne({ _id: courseId, status: 'ACTIVE' });
  if (!course) throw new ApiError(404, 'COURSE_NOT_AVAILABLE', 'Choose an active course');
  const batch = await coursesService.ensureCourseBatch(course);
  const existing = await Enrollment.findOne({ batchId: batch._id, studentId: user.id, status: 'ACTIVE' });
  if (existing) throw new ApiError(409, 'ALREADY_ENROLLED', 'You are already enrolled in this course');
  try {
    const enrollment = await Enrollment.create({ studentId: user.id, batchId: batch._id, courseId: course._id, createdBy: user.id });
    await audit.log({ actorId: user.id, action: 'STUDENT_ENROLLED', entityType: 'Enrollment', entityId: enrollment._id, metadata: { courseId: String(course._id) } });
    return enrollment;
  } catch (error) {
    if (error.code === 11000) throw new ApiError(409, 'ALREADY_ENROLLED', 'You are already enrolled in this course');
    throw error;
  }
}

async function requestCourse(user, requestedCourseName) {
  if (user.role !== 'STUDENT') throw new ApiError(403, 'STUDENT_ONLY', 'Only students can request a course');
  const name = String(requestedCourseName).trim().replace(/\s+/g, ' ');
  const student = await User.findOneAndUpdate(
    { _id: user.id, role: 'STUDENT' },
    { $set: { requestedCourseName: name } },
    { new: true, runValidators: true }
  ).select('requestedCourseName');
  if (!student) throw new ApiError(404, 'USER_NOT_FOUND', 'Student account not found');
  await audit.log({ actorId: user.id, action: 'STUDENT_COURSE_REQUESTED', entityType: 'User', entityId: user.id, metadata: { requestedCourseName: name } });
  return { requestedCourseName: student.requestedCourseName };
}

async function enrollStudents(actor, batchId, studentIds) {
  const batch = await Batch.findById(batchId);
  if (!batch) throw new ApiError(404, 'BATCH_NOT_FOUND', 'Batch not found');
  if (batch.status !== 'ACTIVE') throw new ApiError(409, 'BATCH_NOT_ACTIVE', 'Students can only be enrolled in ACTIVE batches');
  const students = await User.find({ _id: { $in: studentIds } }).select('role status').lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));
  const created = [];
  const skipped = [];
  for (const id of [...new Set(studentIds)]) {
    const s = byId.get(String(id));
    if (!s || s.role !== 'STUDENT' || s.status !== 'ACTIVE') { skipped.push({ studentId: id, reason: 'INVALID_STUDENT' }); continue; }
    try {
      const e = await Enrollment.create({ studentId: id, batchId, courseId: batch.courseId, createdBy: actor.id });
      await audit.log({ actorId: actor.id, action: 'STUDENT_ENROLLED', entityType: 'Enrollment', entityId: e._id, newStatus: 'ACTIVE', metadata: { studentId: id, batchId } });
      created.push(e);
    } catch (err) {
      if (err.code === 11000) skipped.push({ studentId: id, reason: 'ALREADY_ENROLLED' });
      else throw err;
    }
  }
  return { created, skipped };
}

async function updateStatus(actor, enrollmentId, { status, reason }) {
  const e = await Enrollment.findById(enrollmentId);
  if (!e) throw new ApiError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found');
  if (e.status !== 'ACTIVE') throw new ApiError(409, 'ENROLLMENT_NOT_ACTIVE', `Enrollment is already ${e.status}`);
  e.status = status;
  e.endedAt = new Date();
  await e.save();
  await audit.log({
    actorId: actor.id,
    action: status === 'DROPPED' ? 'STUDENT_REMOVED' : 'ENROLLMENT_STATUS_CHANGED',
    entityType: 'Enrollment',
    entityId: e._id,
    previousStatus: 'ACTIVE',
    newStatus: status,
    reason,
  });
  return e;
}

// Transfer: old enrollment -> TRANSFERRED, new ACTIVE enrollment, audit. History stays on the old enrollment.
// Replica set: single transaction. Plain MongoDB: ordered writes with rollback on any failure.
async function transfer(actor, enrollmentId, { targetCourseId, targetBatchId, reason }) {
  return runInTransaction(async (txn) => {
    const opt = txn ? { session: txn } : {};
    const old = await Enrollment.findById(enrollmentId).session(txn || null);
    if (!old) throw new ApiError(404, 'ENROLLMENT_NOT_FOUND', 'Enrollment not found');
    if (old.status !== 'ACTIVE') throw new ApiError(409, 'ENROLLMENT_NOT_ACTIVE', `Enrollment is ${old.status}`);

    let targetBatch = null;
    if (targetBatchId) {
      targetBatch = await Batch.findById(targetBatchId).session(txn || null);
      if (!targetBatch) throw new ApiError(404, 'BATCH_NOT_FOUND', 'Target batch not found');
      if (String(targetBatch._id) === String(old.batchId)) throw new ApiError(400, 'SAME_BATCH', 'Target batch must differ from the current batch');
    }

    const resolvedCourseId = targetCourseId || (targetBatch && targetBatch.courseId ? String(targetBatch.courseId) : undefined);
    if (!resolvedCourseId) throw new ApiError(404, 'COURSE_NOT_AVAILABLE', 'Target course could not be resolved');
    if (targetCourseId && String(old.courseId) === String(resolvedCourseId)) throw new ApiError(400, 'SAME_COURSE', 'Target course must differ from the current course');

    const course = await Course.findOne({ _id: resolvedCourseId, status: 'ACTIVE' }).session(txn || null);
    if (!course) throw new ApiError(404, 'COURSE_NOT_AVAILABLE', 'Target course is not active');
    const target = targetBatch || await coursesService.ensureCourseBatch(course, actor.id);
    if (target.status !== 'ACTIVE') throw new ApiError(409, 'BATCH_NOT_ACTIVE', 'Target batch is not ACTIVE');
    const existing = await Enrollment.findOne({ batchId: target._id, studentId: old.studentId, status: 'ACTIVE' }).session(txn || null);
    if (existing) throw new ApiError(409, 'ALREADY_ENROLLED', 'Student is already enrolled in the target course');

    const now = new Date();
    // Atomic gate: only one concurrent transfer can move this enrollment out of ACTIVE.
    const moved = await Enrollment.findOneAndUpdate({ _id: old._id, status: 'ACTIVE' }, { $set: { status: 'TRANSFERRED', endedAt: now } }, { new: true, ...opt });
    if (!moved) throw new ApiError(409, 'ENROLLMENT_NOT_ACTIVE', 'Enrollment changed, please retry');
    let fresh;
    try {
      [fresh] = await Enrollment.create(
        [{ studentId: old.studentId, batchId: target._id, courseId: target.courseId, enrolledAt: now, transferredFrom: old._id, createdBy: actor.id }],
        opt
      );
      await audit.log(
        { actorId: actor.id, action: 'STUDENT_MOVED', entityType: 'Enrollment', entityId: old._id, previousStatus: 'ACTIVE', newStatus: 'TRANSFERRED', reason,
          metadata: { fromBatchId: old.batchId, toBatchId: target._id, newEnrollmentId: fresh._id, studentId: old.studentId } },
        txn
      );
    } catch (e) {
      if (!txn) { // roll back manually on a plain MongoDB
        if (fresh) await Enrollment.deleteOne({ _id: fresh._id });
        await Enrollment.updateOne({ _id: old._id }, { $set: { status: 'ACTIVE' }, $unset: { endedAt: 1 } });
      }
      throw e;
    }
    return { previous: moved, current: fresh };
  });
}

module.exports = { enrollStudents, joinCourse, requestCourse, updateStatus, transfer };
