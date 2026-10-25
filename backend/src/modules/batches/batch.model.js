const mongoose = require('mongoose');
const { BATCH_STATUS } = require('../../utils/constants');

const batchSchema = new mongoose.Schema(
  {
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    isCourseGroup: { type: Boolean, default: false, select: false },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    schedule: {
      daysOfWeek: { type: [Number], default: [] }, // 0 = Sunday
      startTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
      endTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    },
    status: { type: String, enum: BATCH_STATUS, default: 'ACTIVE', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
batchSchema.index({ courseId: 1, name: 1 }, { unique: true });
batchSchema.index({ courseId: 1 }, { unique: true, partialFilterExpression: { isCourseGroup: true }, name: 'one_course_group_batch' });

module.exports = mongoose.models.Batch || mongoose.model('Batch', batchSchema);
