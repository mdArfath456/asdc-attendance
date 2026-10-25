const mongoose = require('mongoose');
const ApiError = require('../../utils/ApiError');
const env = require('../../config/env');
const realtime = require('../../config/realtime');
const AttendanceSession = require('./attendanceSession.model');
const AttendanceRecord = require('./attendanceRecord.model');
const Enrollment = require('../enrollments/enrollment.model');
const { assertBatchAccess } = require('../batches/batches.service');
const audit = require('../audit/audit.service');
const qr = require('./qr.service');
const { runInTransaction } = require('../../utils/transaction');
const { sessionDateFor } = require('../../utils/dates');

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
  const duration = opts.durationMinutes ?? env.SESSION_DURATION_MINUTES;
  let session;
  try {
    session = await AttendanceSession.create({
      batchId: batch._id,
      courseId: batch.courseId,
      title: opts.title,
      sessionDate: sessionDateFor(now),
      scheduledStart: now,
      scheduledEnd: new Date(now.getTime() + duration * 60000),
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
    if (e.code === 11000) throw new ApiError(409, 'SESSION_ALREADY_OPEN', 'An attendance session is already open for this batch');
    throw e;
  }
  await audit.log({ actorId: user.id, action: 'SESSION_STARTED', entityType: 'AttendanceSession', entityId: session._id, newStatus: 'OPEN', metadata: { batchId: batch._id, durationMinutes: duration } });
  return { session, qr: qr.describe(session, now) };
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
      update: { $setOnInsert: { sessionId: session._id, enrollmentId: e._id, studentId: e.studentId, batchId: session.batchId, status: 'ABSENT', checkInTimestamp: null, recordedMethod: 'SYSTEM_AUTO_ABSENT', ...(actorId ? { recordedBy: actorId } : {}) } },
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

async function cancelSession(user, sessionId, reason) {
  const session = await loadSessionWithAccess(user, sessionId, { manage: true });
  if (!['SCHEDULED', 'OPEN'].includes(session.status)) throw new ApiError(409, 'SESSION_NOT_CANCELLABLE', `A ${session.status} session cannot be cancelled`);
  const previous = session.status;
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, status: previous },
    { $set: { status: 'CANCELLED', cancelReason: reason, closedBy: user.id, actualEndTime: new Date() } },
    { new: true }
  );
  if (!updated) throw new ApiError(409, 'SESSION_STATE_CHANGED', 'Session state changed, please retry');
  await audit.log({ actorId: user.id, action: 'SESSION_CANCELLED', entityType: 'AttendanceSession', entityId: session._id, previousStatus: previous, newStatus: 'CANCELLED', reason });
  realtime.emitToSession(session._id, 'session:closed', { sessionId: String(session._id), cancelled: true });
  return updated;
}

async function autoCloseExpiredSessions() {
  const due = await AttendanceSession.find({ status: 'OPEN', scheduledEnd: { $lte: new Date() } }).select('_id').lean();
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

module.exports = { loadSessionWithAccess, startSession, rotateToken, getSession, listForBatch, listRecords, closeSession, closeSessionInternal, cancelSession, autoCloseExpiredSessions, stats, countByStatus };
