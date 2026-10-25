const { z } = require('zod');
const { objectId } = require('../../utils/zodHelpers');
const filters = {
  courseId: objectId.optional(),
  batchId: objectId.optional(),
  studentId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
exports.reportQuery = z.object({ ...filters, page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(500).default(100) }).strict();
exports.exportQuery = z.object({ ...filters, format: z.enum(['csv', 'json']).default('csv') }).strict();
exports.summaryQuery = z.object({ courseId: filters.courseId, batchId: filters.batchId, from: filters.from, to: filters.to }).strict();
