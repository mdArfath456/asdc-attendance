const ApiError = require('../../utils/ApiError');
const User = require('./user.model');
const audit = require('../audit/audit.service');

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function getById(id) {
  const user = await User.findById(id);
  if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}

async function list({ role, status, search, page, limit }) {
  const filter = {};
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, total, page, limit };
}

function assertCanManage(actor, target) {
  if (actor.id === String(target._id)) throw new ApiError(400, 'CANNOT_MODIFY_SELF', 'You cannot modify your own account here');
  if (target.role === 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'The administrator account cannot be modified here');
}

async function setStatus(actor, userId, { status, reason }) {
  const target = await getById(userId);
  assertCanManage(actor, target);
  const previous = target.status;
  if (previous === status) return target;
  target.status = status;
  await target.save();
  if (status !== 'ACTIVE') await require('../auth/auth.service').revokeAllForUser(target._id);
  await audit.log({ actorId: actor.id, action: 'USER_STATUS_CHANGED', entityType: 'User', entityId: target._id, previousStatus: previous, newStatus: status, reason });
  return target;
}

module.exports = { getById, list, setStatus };
