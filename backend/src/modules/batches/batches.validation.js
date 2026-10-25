const { z } = require('zod');
const { objectId } = require('../../utils/zodHelpers');
const { BATCH_STATUS } = require('../../utils/constants');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const base = {
  courseId: objectId,
  name: z.string().trim().min(1).max(120),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  schedule: z.object({ daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(), startTime: time.optional(), endTime: time.optional() }).strict().optional(),
  status: z.enum(BATCH_STATUS).optional(),
};
exports.create = z.object(base).strict();
exports.update = z.object(base).omit({ courseId: true }).partial().strict().refine((o) => Object.keys(o).length > 0, 'No fields to update');
exports.listQuery = z.object({ courseId: objectId.optional(), status: z.enum(BATCH_STATUS).optional() }).strict();
exports.batchParams = z.object({ batchId: objectId });
exports.trainerParams = z.object({ batchId: objectId, trainerId: objectId });
exports.assignTrainer = z.object({ trainerId: objectId, isPrimary: z.boolean().optional(), canManageSessions: z.boolean().optional() }).strict();
