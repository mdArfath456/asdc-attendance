const ApiError = require('../../utils/ApiError');
const realtime = require('../../config/realtime');
const AttendanceSession = require('./attendanceSession.model');
const AttendanceRecord = require('./attendanceRecord.model');
const Enrollment = require('../enrollments/enrollment.model');
const qr = require('./qr.service');

// Student check-in. Identity comes ONLY from the authenticated user (req.user).
async function checkIn(user, { token }) {
  const now = new Date(); // server-controlled UTC time
  const parsed = qr.parseToken(token); // signature verified -> QR_INVALID otherwise
  const session = await AttendanceSession.findById(parsed.sessionId);
  if (!session) throw new ApiError(400, 'QR_INVALID', 'Invalid QR code');

  if (session.status === 'CLOSED' || session.status === 'CANCELLED') throw new ApiError(409, 'SESSION_CLOSED', `This attendance session is ${session.status.toLowerCase()}`);
  if (session.status !== 'OPEN') throw new ApiError(409, 'SESSION_NOT_OPEN', 'This attendance session is not open yet');

  qr.validateAgainstSession(session, parsed, now); // QR_EXPIRED / QR_INVALID (incl. grace window)

  const enrollment = await Enrollment.findOne({ studentId: user.id, batchId: session.batchId, status: 'ACTIVE' });
  if (!enrollment) {
    const any = await Enrollment.exists({ studentId: user.id, batchId: session.batchId });
    throw any
      ? new ApiError(403, 'ENROLLMENT_INELIGIBLE', 'Your enrollment in this batch is not active')
      : new ApiError(403, 'BATCH_MISMATCH', 'You are not enrolled in the batch for this session');
  }

  const lateCutoff = new Date(session.actualStartTime.getTime() + session.lateThresholdMinutes * 60000);
  const status = now <= lateCutoff ? 'PRESENT' : 'LATE';

  let record;
  try {
    record = await AttendanceRecord.create({
      sessionId: session._id, enrollmentId: enrollment._id, studentId: user.id, batchId: session.batchId,
      status, checkInTimestamp: now, recordedMethod: 'QR_SCAN', recordedBy: user.id,
    });
  } catch (e) {
    if (e.code === 11000) {
      const existing = await AttendanceRecord.findOne({ sessionId: session._id, enrollmentId: enrollment._id }).select('status').lean();
      throw new ApiError(409, 'ALREADY_CHECKED_IN', 'Attendance already recorded for this session', { status: existing && existing.status });
    }
    throw e;
  }

  realtime.emitToSession(session._id, 'attendance:checkin', {
    sessionId: String(session._id), recordId: String(record._id), enrollmentId: String(enrollment._id),
    student: { id: user.id, name: user.name }, status, checkInTimestamp: now,
  });
  return { recordId: String(record._id), status, checkInTimestamp: now, sessionId: String(session._id), batchId: String(session.batchId) };
}

module.exports = { checkIn };
