const ApiError = require('../../utils/ApiError');
const realtime = require('../../config/realtime');
const AttendanceRecord = require('./attendanceRecord.model');
const AttendanceSession = require('./attendanceSession.model');
const audit = require('../audit/audit.service');
const { runInTransaction } = require('../../utils/transaction');

// Record update + immutable AuditLog entry. Replica set: one transaction.
// Plain MongoDB: the record is updated first, and restored if the audit write fails (never an unaudited change).
async function correctRecord(actor, recordId, { status, reason }) {
  const result = await runInTransaction(async (txn) => {
    const opt = txn ? { session: txn } : {};
    const record = await AttendanceRecord.findById(recordId).session(txn || null);
    if (!record) throw new ApiError(404, 'RECORD_NOT_FOUND', 'Attendance record not found');
    const session = await AttendanceSession.findById(record.sessionId).session(txn || null);
    if (!session || session.status !== 'CLOSED') throw new ApiError(409, 'SESSION_NOT_CLOSED', 'Corrections are only allowed on CLOSED sessions');
    if (record.status === status) throw new ApiError(400, 'NO_CHANGE', 'Record already has this status');
    const before = { status: record.status, lastModifiedBy: record.lastModifiedBy, correctionReason: record.correctionReason, recordedMethod: record.recordedMethod };
    record.status = status;
    record.lastModifiedBy = actor.id;
    record.correctionReason = reason;
    record.recordedMethod = 'ADMIN_MANUAL';
    await record.save(opt);
    try {
      await audit.log({
        actorId: actor.id, action: 'ATTENDANCE_CORRECTED', entityType: 'AttendanceRecord', entityId: record._id,
        previousStatus: before.status, newStatus: status, reason,
        metadata: { sessionId: record.sessionId, studentId: record.studentId, batchId: record.batchId },
      }, txn);
    } catch (e) {
      if (!txn) await AttendanceRecord.updateOne({ _id: record._id }, { $set: before }); // compensate
      throw e;
    }
    return record;
  });
  realtime.emitToSession(result.sessionId, 'attendance:corrected', { recordId: String(result._id), status: result.status });
  return result;
}

module.exports = { correctRecord };
