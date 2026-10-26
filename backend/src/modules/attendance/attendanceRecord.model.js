const mongoose = require('mongoose');
const { ATTENDANCE_STATUS, RECORD_METHOD } = require('../../utils/constants');

const recordSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'AttendanceSession', required: true },
    enrollmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    sessionDate: { type: Date, required: true },
    status: { type: String, enum: ATTENDANCE_STATUS, required: true },
    checkInTimestamp: { type: Date, default: null },
    recordedMethod: { type: String, enum: RECORD_METHOD, required: true },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastModifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    correctionReason: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);
recordSchema.index({ sessionId: 1, enrollmentId: 1 }, { unique: true });
recordSchema.index({ enrollmentId: 1, sessionDate: 1 }, { unique: true, name: 'one_attendance_per_enrollment_per_day' });
recordSchema.index({ studentId: 1, batchId: 1 });
recordSchema.index({ batchId: 1, status: 1 });

module.exports = mongoose.models.AttendanceRecord || mongoose.model('AttendanceRecord', recordSchema);
