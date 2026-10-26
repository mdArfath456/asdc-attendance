const mongoose = require('mongoose');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const realtime = require('../../config/realtime');
const AttendanceSession = require('./attendanceSession.model');
const AttendanceRecord = require('./attendanceRecord.model');
const Enrollment = require('../enrollments/enrollment.model');
const Batch = require('../batches/batch.model');
const Course = require('../courses/course.model');
const TrainerAssignment = require('../batches/trainerAssignment.model');
const { assertBatchAccess } = require('../batches/batches.service');
const audit = require('../audit/audit.service');
const qr = require('./qr.service');
const { runInTransaction } = require('../../utils/transaction');
const { sessionDateFor, sessionDayEndFor } = require('../../utils/dates');

async function loadSessionWithAccess(user, sessionId, { manage = false } = {}) {
  if (!mongoose.isValidObjectId(sessionId)) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
  const session = await AttendanceSession.findById(sessionId);
  if (!session) throw new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found');
  await assertBatchAccess(user, session.batchId, { manage });
  return session;
}

async function startSession(user, batchId, opts = {}) {
  const batch = await assertBatchAccess(user, batchId, { manage: true });
  if (batch.status !== 'ACTIVE') throw new ApiError(409, 'BATCH_NOT_ACTIVE', 'Sessions can only be started for ACTIVE batches');
  const now = new Date();
  const sessionDate = sessionDateFor(now);
  const today = await AttendanceSession.findOne({
    batchId: batch._id,
    sessionDate,
    status: { $in: ['SCHEDULED', 'OPEN', 'CLOSED'] },
  });
  if (today) return existingSessionResult(today, now);

  const duration = opts.durationMinutes ?? env.SESSION_DURATION_MINUTES;
  const scheduledEnd = new Date(Math.min(now.getTime() + duration * 60000, sessionDayEndFor(now).getTime()));
  if (scheduledEnd <= now) throw new ApiError(409, 'SESSION_DAY_ENDED', 'A new attendance session cannot be started after today has ended');
  let session;
  try {
    session = await AttendanceSession.create({
      batchId: batch._id,
      courseId: batch.courseId,
      title: opts.title,
      sessionDate,
      scheduledStart: now,
      scheduledEnd,
      createdBy: user.id,
      status: 'OPEN',
      actualStartTime: now,
      lateThresholdMinutes: opts.lateThresholdMinutes ?? env.LATE_THRESHOLD_MINUTES,
      currentTokenVersion: 1,
      lastRotatedAt: now,
      refreshIntervalSeconds: opts.refreshIntervalSeconds ?? env.QR_REFRESH_SECONDS,
      gracePeriodSeconds: env.QR_GRACE_SECONDS,
    });
  } catch (e) {
    if (e.code === 11000) {
      const existing = await AttendanceSession.findOne({
        batchId: batch._id,
        sessionDate,
        status: { $in: ['SCHEDULED', 'OPEN', 'CLOSED'] },
      });
      if (existing) return existingSessionResult(existing, now);
      const open = await AttendanceSession.findOne({ batchId: batch._id, status: 'OPEN' });
      if (open) throw new ApiError(409, 'SESSION_ALREADY_OPEN', 'An attendance session is already open for this batch');
    }
    throw e;
  }
  await audit.log({ actorId: user.id, action: 'SESSION_STARTED', entityType: 'AttendanceSession', entityId: session._id, newStatus: 'OPEN', metadata: { batchId: batch._id, durationMinutes: duration } });
  return { session, qr: qr.describe(session, now), resumed: false };
}

function existingSessionResult(session, now) {
  if (session.status === 'CLOSED') {
    throw new ApiError(409, 'SESSION_ALREADY_TAKEN_TODAY', 'Attendance has already been taken for this course today', { sessionId: String(session._id) });
  }
  if (session.status === 'SCHEDULED') {
    throw new ApiError(409, 'SESSION_ALREADY_TAKEN_TODAY', 'An attendance session is already scheduled for this course today', { sessionId: String(session._id) });
  }
  return { session, qr: qr.describe(session, now), resumed: true };
}

// Rotation mutates token metadata only. Calls within 2s of the last rotation are idempotent
// (returns the current token) so double-fired timers cannot burn through versions.
async function rotateToken(user, sessionId) {
  await loadSessionWithAccess(user, sessionId, { manage: true });
  const now = new Date();
  let session = await AttendanceSession.findOneAndUpdate(
    { _id: sessionId, status: 'OPEN', lastRotatedAt: { $lte: new Date(now.getTime() - 2000) } },
    { $inc: { currentTokenVersion: 1 }, $set: { lastRotatedAt: now } },
    { new: true }
  );
  if (!session) session = await AttendanceSession.findOne({ _id: sessionId, status: 'OPEN' });
  if (!session) throw new ApiError(409, 'SESSION_NOT_OPEN', 'Session is not open');
  return qr.describe(session, now);
}

async function countByStatus(sessionId, txn) {
  const agg = AttendanceRecord.aggregate([{ $match: { sessionId: new mongoose.Types.ObjectId(String(sessionId)) } }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  const rows = await (txn ? agg.session(txn) : agg);
  const c = { present: 0, late: 0, absent: 0, excused: 0 };
  rows.forEach((r) => { c[r._id.toLowerCase()] = r.n; });
  return c;
}

async function stats(session) {
  const counts = await countByStatus(session._id);
  const recorded = counts.present + counts.late + counts.absent + counts.excused;
  let total = recorded;
  if (session.status === 'OPEN' || session.status === 'SCHEDULED') {
    total = await Enrollment.countDocuments({ batchId: session.batchId, status: 'ACTIVE', enrolledAt: { $lte: session.actualStartTime || new Date() } });
  }
  return { ...counts, totalEnrollments: total, pending: Math.max(total - recorded, 0) };
}

async function getSession(user, sessionId) {
  const session = await loadSessionWithAccess(user, sessionId);
  return { session, stats: await stats(session) };
}

async function listForBatch(user, batchId) {
  await assertBatchAccess(user, batchId);
  return AttendanceSession.find({ batchId }).sort({ scheduledStart: -1 }).limit(100);
}

async function getTodayForBatch(user, batchId) {
  await assertBatchAccess(user, batchId);
  return AttendanceSession.findOne({
    batchId,
    sessionDate: sessionDateFor(),
    status: { $in: ['SCHEDULED', 'OPEN', 'CLOSED'] },
  });
}

async function getTodayForStaff(user) {
  const [activeCourseIds, assignedBatchIds] = await Promise.all([
    Course.distinct('_id', { status: 'ACTIVE' }),
    user.role === 'TRAINER' ? TrainerAssignment.distinct('batchId', { trainerId: user.id }) : Promise.resolve(null),
  ]);
  const filter = { courseId: { $in: activeCourseIds }, isCourseGroup: true, status: 'ACTIVE' };
  if (assignedBatchIds) filter._id = { $in: assignedBatchIds };
  const batches = await Batch.find(filter)
    .select('+isCourseGroup courseId')
    .populate('courseId', 'name')
    .lean();
  if (!batches.length) return [];

  const today = sessionDateFor();
  const sessions = await AttendanceSession.find({
    batchId: { $in: batches.map((batch) => batch._id) },
    sessionDate: today,
    status: { $in: ['SCHEDULED', 'OPEN', 'CLOSED'] },
  })
    .select('batchId courseId title sessionDate status scheduledEnd actualStartTime actualEndTime')
    .lean();
  const batchById = new Map(batches.map((batch) => [String(batch._id), batch]));
  return sessions.map((session) => {
    const batch = batchById.get(String(session.batchId));
    return {
      ...session,
      batchId: String(session.batchId),
      courseId: String(session.courseId),
      courseName: batch?.courseId?.name || batch?.name || 'Course',
    };
  });
}

async function getStudentToday(user) {
  const today = sessionDateFor();
  const enrollments = await Enrollment.find({ studentId: user.id, status: 'ACTIVE' })
    .populate('courseId', 'name code')
    .populate('batchId', 'name')
    .sort({ enrolledAt: 1 })
    .lean();
  if (!enrollments.length) return { sessionDate: today, courses: [] };
  const enrollmentIds = enrollments.map((enrollment) => enrollment._id);
  const batchIds = enrollments.map((enrollment) => enrollment.batchId?._id).filter(Boolean);
  const [sessions, records] = await Promise.all([
    AttendanceSession.find({ batchId: { $in: batchIds }, sessionDate: today, status: { $in: ['SCHEDULED', 'OPEN', 'CLOSED'] } }).lean(),
    AttendanceRecord.find({ enrollmentId: { $in: enrollmentIds }, sessionDate: today }).lean(),
  ]);
  const sessionByBatch = new Map(sessions.map((session) => [String(session.batchId), session]));
  const recordByEnrollment = new Map(records.map((record) => [String(record.enrollmentId), record]));
  return {
    sessionDate: today,
    courses: enrollments.map((enrollment) => {
      const session = sessionByBatch.get(String(enrollment.batchId?._id));
      const record = recordByEnrollment.get(String(enrollment._id));
      let state = 'NO_SESSION';
      if (record) state = 'RECORDED';
      else if (session?.status === 'OPEN' || session?.status === 'SCHEDULED') state = 'NOT_RECORDED';
      else if (session?.status === 'CLOSED') state = 'SESSION_CLOSED';
      return {
        enrollmentId: String(enrollment._id),
        course: enrollment.courseId && { id: String(enrollment.courseId._id), name: enrollment.courseId.name, code: enrollment.courseId.code },
        batch: enrollment.batchId && { id: String(enrollment.batchId._id), name: enrollment.batchId.name },
        session: session && { id: String(session._id), title: session.title, status: session.status },
        state,
        record: record && { status: record.status, checkInTimestamp: record.checkInTimestamp },
      };
    }),
  };
}

async function listRecords(user, sessionId) {
  const session = await loadSessionWithAccess(user, sessionId);
  const records = await AttendanceRecord.find({ sessionId: session._id }).populate('studentId', 'name email').sort({ checkInTimestamp: 1, createdAt: 1 }).lean();
  let pending = [];
  if (session.status === 'OPEN') {
    const done = new Set(records.map((r) => String(r.enrollmentId)));
    const enrolled = await Enrollment.find({ batchId: session.batchId, status: 'ACTIVE', enrolledAt: { $lte: session.actualStartTime } }).populate('studentId', 'name email').lean();
    pending = enrolled.filter((e) => !done.has(String(e._id))).map((e) => ({ enrollmentId: String(e._id), student: e.studentId && { id: String(e.studentId._id), name: e.studentId.name, email: e.studentId.email } }));
  }
  const shaped = records.map((r) => ({
    id: String(r._id), enrollmentId: String(r.enrollmentId), status: r.status, checkInTimestamp: r.checkInTimestamp,
    recordedMethod: r.recordedMethod, correctionReason: r.correctionReason,
    student: r.studentId && { id: String(r.studentId._id), name: r.studentId.name, email: r.studentId.email },
  }));
  return { session, records: shaped, pending };
}

// Idempotent: upserts ABSENT records ($setOnInsert, never overwrites) for every ACTIVE enrollment
// that has no record yet, then stamps absentGeneratedAt.
async function generateAbsents(session, actorId, txn) {
  const enrollments = await Enrollment.find({ batchId: session.batchId, status: 'ACTIVE', enrolledAt: { $lte: session.actualStartTime } }).select('_id studentId').session(txn || null).lean();
  const ops = enrollments.map((e) => ({
    updateOne: {
      filter: { sessionId: session._id, enrollmentId: e._id },
      update: { $setOnInsert: { sessionId: session._id, enrollmentId: e._id, studentId: e.studentId, batchId: session.batchId, sessionDate: session.sessionDate, status: 'ABSENT', checkInTimestamp: null, recordedMethod: 'SYSTEM_AUTO_ABSENT', ...(actorId ? { recordedBy: actorId } : {}) } },
      upsert: true,
    },
  }));
  let absentCreated = 0;
  if (ops.length) {
    const r = await AttendanceRecord.bulkWrite(ops, { ordered: false, ...(txn ? { session: txn } : {}) });
    absentCreated = r.upsertedCount || 0;
  }
  await AttendanceSession.updateOne({ _id: session._id }, { $set: { absentGeneratedAt: new Date() } }, txn ? { session: txn } : {});
  return absentCreated;
}

// Closes the session (atomic OPEN -> CLOSED gate blocks further check-ins) and creates ABSENT records.
// With a replica set this is one transaction; on a plain MongoDB the gate is a single atomic update,
// the bulk upsert is idempotent and a repair job finishes it if the process dies in between.
async function closeSessionInternal(sessionId, actorId) {
  const now = new Date();
  const result = await runInTransaction(async (txn) => {
    const opt = txn ? { session: txn } : {};
    const session = await AttendanceSession.findOneAndUpdate(
      { _id: sessionId, status: 'OPEN' },
      { $set: { status: 'CLOSED', actualEndTime: now, ...(actorId ? { closedBy: actorId } : {}) } },
      { new: true, ...opt }
    );
    if (!session) throw new ApiError(409, 'SESSION_NOT_OPEN', 'Session is not open');
    const absentCreated = await generateAbsents(session, actorId, txn);
    const counts = await countByStatus(session._id, txn);
    await audit.log({ actorId: actorId || null, action: 'SESSION_CLOSED', entityType: 'AttendanceSession', entityId: session._id, previousStatus: 'OPEN', newStatus: 'CLOSED', metadata: { absentCreated, counts, auto: !actorId } }, txn);
    return { session, absentCreated, counts };
  });
  realtime.emitToSession(sessionId, 'session:closed', { sessionId: String(sessionId), counts: result.counts });
  return result;
}

async function closeSession(user, sessionId) {
  await loadSessionWithAccess(user, sessionId, { manage: true });
  return closeSessionInternal(sessionId, user.id);
}

async function reopenSession(user, sessionId) {
  const session = await loadSessionWithAccess(user, sessionId, { manage: true });
  if (session.status !== 'CLOSED') throw new ApiError(409, 'SESSION_NOT_CLOSED', 'Only a closed session can be reopened');
  const now = new Date();
  if (session.sessionDate.getTime() !== sessionDateFor(now).getTime()) {
    throw new ApiError(409, 'SESSION_NOT_TODAY', 'Only today’s closed session can be reopened');
  }
  const scheduledEnd = sessionDayEndFor(now);
  if (scheduledEnd <= now) throw new ApiError(409, 'SESSION_DAY_ENDED', 'Today’s attendance window has ended');

  const result = await runInTransaction(async (txn) => {
    const options = txn ? { session: txn } : {};
    await AttendanceSession.updateOne(
      { _id: session._id, status: 'CLOSED' },
      { $unset: { absentGeneratedAt: 1 } },
      options
    );
    const removed = await AttendanceRecord.deleteMany(
      { sessionId: session._id, recordedMethod: 'SYSTEM_AUTO_ABSENT' },
      options
    );
    const reopened = await AttendanceSession.findOneAndUpdate(
      { _id: session._id, status: 'CLOSED', sessionDate: sessionDateFor(now) },
      {
        $set: { status: 'OPEN', actualEndTime: null, lastRotatedAt: now, scheduledEnd },
        $unset: { absentGeneratedAt: 1, closedBy: 1 },
        $inc: { currentTokenVersion: 1 },
      },
      { new: true, ...options }
    );
    if (!reopened) throw new ApiError(409, 'SESSION_STATE_CHANGED', 'Session state changed, please retry');
    await audit.log({
      actorId: user.id,
      action: 'SESSION_REOPENED',
      entityType: 'AttendanceSession',
      entityId: reopened._id,
      previousStatus: 'CLOSED',
      newStatus: 'OPEN',
      metadata: { removedAutoAbsentRecords: removed.deletedCount || 0 },
    }, txn);
    return { session: reopened, qr: qr.describe(reopened, now), removedAutoAbsentRecords: removed.deletedCount || 0 };
  });
  realtime.emitToSession(session._id, 'session:reopened', { sessionId: String(session._id) });
  return result;
}

async function cancelSession(user, sessionId, reason) {
  const session = await loadSessionWithAccess(user, sessionId, { manage: true });
  if (!['SCHEDULED', 'OPEN'].includes(session.status)) throw new ApiError(409, 'SESSION_NOT_CANCELLABLE', `A ${session.status} session cannot be cancelled`);
  const previous = session.status;
  const result = await runInTransaction(async (txn) => {
    const options = txn ? { session: txn } : {};
    const updated = await AttendanceSession.findOneAndUpdate(
      { _id: session._id, status: previous },
      { $set: { status: 'CANCELLED', cancelReason: reason, closedBy: user.id, actualEndTime: new Date() } },
      { new: true, ...options }
    );
    if (!updated) throw new ApiError(409, 'SESSION_STATE_CHANGED', 'Session state changed, please retry');
    const removedRecords = await AttendanceRecord.deleteMany({ sessionId: session._id }, options);
    await audit.log({
      actorId: user.id,
      action: 'SESSION_CANCELLED',
      entityType: 'AttendanceSession',
      entityId: session._id,
      previousStatus: previous,
      newStatus: 'CANCELLED',
      reason,
      metadata: { removedRecords: removedRecords.deletedCount || 0 },
    }, txn);
    return updated;
  });
  realtime.emitToSession(session._id, 'session:closed', { sessionId: String(session._id), cancelled: true });
  return result;
}

async function autoCloseExpiredSessions() {
  const now = new Date();
  const today = sessionDateFor(now);
  const due = await AttendanceSession.find({
    status: 'OPEN',
    $or: [{ scheduledEnd: { $lte: now } }, { sessionDate: { $lt: today } }],
  }).select('_id').lean();
  for (const s of due) {
    try { await closeSessionInternal(s._id, null); } catch (e) { if (e.code !== 'SESSION_NOT_OPEN') console.error('[auto-close]', e.message); }
  }
  // Repair: sessions closed but whose ABSENT generation did not finish (e.g. process crash).
  const stuck = await AttendanceSession.find({ status: 'CLOSED', absentGeneratedAt: { $exists: false }, actualEndTime: { $lte: new Date(Date.now() - 60000) } }).limit(20);
  for (const s of stuck) {
    try { await generateAbsents(s, s.closedBy || null); } catch (e) { console.error('[repair-absents]', e.message); }
  }
  return due.length;
}

module.exports = { loadSessionWithAccess, startSession, rotateToken, getSession, listForBatch, getTodayForBatch, getTodayForStaff, getStudentToday, listRecords, closeSession, closeSessionInternal, cancelSession, reopenSession, autoCloseExpiredSessions, stats, countByStatus };
