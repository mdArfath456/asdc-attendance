const { z } = require('zod');
const { objectId, pagination } = require('../../utils/zodHelpers');
exports.listQuery = z.object({
  action: z.string().max(60).optional(),
  actorId: objectId.optional(),
  entityType: z.string().max(60).optional(),
  entityId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...pagination,
}).strict();
