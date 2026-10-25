const { z } = require('zod');
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
};
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
module.exports = { objectId, pagination, slugify };
