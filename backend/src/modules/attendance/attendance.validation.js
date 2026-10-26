const { z } = require('zod');
const { objectId } = require('../../utils/zodHelpers');
exports.batchParams = z.object({ batchId: objectId });
exports.sessionParams = z.object({ sessionId: objectId });
exports.recordParams = z.object({ recordId: objectId });
exports.start = z.object({
  title: z.string().trim().max(160).optional(),
  lateThresholdMinutes: z.number().int().min(0).max(240).optional(),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  refreshIntervalSeconds: z.number().int().min(5).max(120).optional(),
}).strict();
exports.cancel = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
// strict(): a client-supplied studentId (proxy attendance attempt) is rejected outright.
exports.checkIn = z.object({
  token: z.string().min(10).max(300),
  expectedBatchId: objectId.optional(),
}).strict();
exports.correct = z.object({
  status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
  reason: z.string().trim().min(5, 'A reason of at least 5 characters is required').max(500),
}).strict();
exports.emptyQuery = z.object({}).strict();
