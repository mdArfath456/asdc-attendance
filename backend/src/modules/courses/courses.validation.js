const { z } = require('zod');
const { objectId } = require('../../utils/zodHelpers');
const base = {
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(30),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/).max(80).optional(),
  description: z.string().trim().max(4000).optional(),
  durationHours: z.number().min(0).max(10000).optional(),
  isPublic: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
};
exports.create = z.object(base).strict();
exports.update = z.object(base).partial().strict().refine((o) => Object.keys(o).length > 0, 'No fields to update');
exports.idParams = z.object({ courseId: objectId });
exports.slugParams = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/).max(80) });
exports.studentSearch = z.object({ search: z.string().trim().max(100).optional() }).strict();
exports.pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  courseId: objectId.optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
}).strict();
exports.assignTrainer = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
exports.enrollRequested = z.object({ requestedCourseName: z.string().trim().min(2).max(80).optional() }).strict();
exports.trainerParams = z.object({ courseId: objectId, trainerId: objectId });
