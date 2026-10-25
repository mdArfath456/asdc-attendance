const { z } = require('zod');
const { USER_STATUS } = require('../../utils/constants');
const { objectId, pagination } = require('../../utils/zodHelpers');

exports.listQuery = z.object({
  status: z.enum(USER_STATUS).optional(),
  search: z.string().trim().max(100).optional(),
  ...pagination,
}).strict();
exports.userIdParams = z.object({ userId: objectId });
exports.statusBody = z.object({ status: z.enum(USER_STATUS), reason: z.string().trim().max(500).optional() }).strict();
