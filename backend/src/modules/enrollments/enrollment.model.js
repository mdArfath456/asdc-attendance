const mongoose = require('mongoose');
const { ENROLLMENT_STATUS } = require('../../utils/constants');

const enrollmentSchema = new mongoose.Schema(
  {
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    status: { type: String, enum: ENROLLMENT_STATUS, default: 'ACTIVE' },
    enrolledAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    transferredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
// One ACTIVE enrollment per student per batch (history rows may repeat).
enrollmentSchema.index(
  { batchId: 1, studentId: 1 },
  { unique: true, partialFilterExpression: { status: 'ACTIVE' }, name: 'unique_active_enrollment' }
);
enrollmentSchema.index({ studentId: 1, status: 1 });
enrollmentSchema.index({ batchId: 1, status: 1 });

module.exports = mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema);
