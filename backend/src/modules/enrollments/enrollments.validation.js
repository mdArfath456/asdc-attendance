const { z } = require('zod');
const { objectId } = require('../../utils/zodHelpers');
exports.batchParams = z.object({ batchId: objectId });
exports.enrollParams = z.object({ enrollmentId: objectId });
exports.enroll = z.object({ studentIds: z.array(objectId).min(1).max(200) }).strict();
exports.status = z.object({ status: z.enum(['DROPPED', 'COMPLETED']), reason: z.string().trim().max(500).optional() }).strict();
exports.transfer = z.object({
  targetCourseId: objectId.optional(),
  targetBatchId: objectId.optional(),
  reason: z.string().trim().min(3).max(500).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.targetCourseId && !value.targetBatchId) {
    ctx.addIssue({ code: 'custom', path: ['targetCourseId'], message: 'Either targetCourseId or targetBatchId is required' });
  }
});
exports.join = z.object({ courseId: objectId }).strict();
exports.requestCourse = z.object({
  requestedCourseName: z.string().trim().min(2).max(80).refine((name) => !/[<>]/.test(name), 'Course name cannot contain markup characters'),
}).strict();
