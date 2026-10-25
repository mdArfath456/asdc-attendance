const AuditLog = require('./auditLog.model');

// Append-only. Pass a Mongo session to write inside a transaction.
async function log(entry, session) {
  const [doc] = await AuditLog.create([entry], session ? { session } : {});
  return doc;
}

async function list({ action, actorId, entityType, entityId, from, to, page, limit }) {
  const filter = {};
  if (action) filter.action = action;
  if (actorId) filter.actorId = actorId;
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = entityId;
  if (from || to) filter.createdAt = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).populate('actorId', 'name email role').lean(),
    AuditLog.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

module.exports = { log, list };
