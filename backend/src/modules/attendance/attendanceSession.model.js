const mongoose = require('mongoose');
const { SESSION_STATUS } = require('../../utils/constants');

const sessionSchema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    title: { type: String, trim: true, maxlength: 160 },
    sessionDate: { type: Date, required: true },
    scheduledStart: { type: Date, required: true },
    scheduledEnd: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    closedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: SESSION_STATUS, default: 'SCHEDULED', index: true },
    actualStartTime: { type: Date },
    actualEndTime: { type: Date },
    absentGeneratedAt: { type: Date }, // set once ABSENT records exist (lets a crashed close be repaired)
    cancelReason: { type: String, trim: true, maxlength: 500 },
    lateThresholdMinutes: { type: Number, min: 0, required: true },
    // QR token metadata (rotation only mutates these; it never creates sessions)
    currentTokenVersion: { type: Number, default: 0, min: 0 },
    lastRotatedAt: { type: Date },
    refreshIntervalSeconds: { type: Number, required: true, min: 5 },
    gracePeriodSeconds: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);
// At most one OPEN session per batch.
sessionSchema.index({ batchId: 1 }, { unique: true, partialFilterExpression: { status: 'OPEN' }, name: 'one_open_session_per_batch' });
sessionSchema.index({ batchId: 1, sessionDate: -1 });
sessionSchema.index({ status: 1, scheduledEnd: 1 });

module.exports = mongoose.models.AttendanceSession || mongoose.model('AttendanceSession', sessionSchema);
