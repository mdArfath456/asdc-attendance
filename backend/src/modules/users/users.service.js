const ApiError = require('../../utils/ApiError');
const User = require('./user.model');
const Enrollment = require('../enrollments/enrollment.model');
const { ensureStudentId } = require('./studentId.service');
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

async function setPreferences(actor, { themePreference }) {
  const user = await getById(actor.id);
  user.themePreference = themePreference;
  await user.save();
  return user;
}

async function getIdCard(userId) {
  let student = await User.findOne({ _id: userId, role: 'STUDENT' });
  if (!student) throw new ApiError(404, 'STUDENT_NOT_FOUND', 'Student account not found');
  student = await ensureStudentId(student);

  const enrollments = await Enrollment.find({ studentId: student._id, status: 'ACTIVE' })
    .populate('courseId', 'name code')
    .populate('batchId', 'name')
    .sort({ enrolledAt: 1 })
    .lean();

  return {
    studentId: student.studentId,
    name: student.name,
    email: student.email,
    mobileNumber: student.mobileNumber || null,
    fatherName: student.fatherName || null,
    motherName: student.motherName || null,
    enrollments: enrollments.map((enrollment) => ({
      id: String(enrollment._id),
      course: enrollment.courseId ? { name: enrollment.courseId.name, code: enrollment.courseId.code } : null,
      batch: enrollment.batchId ? { name: enrollment.batchId.name } : null,
    })),
  };
}

module.exports = { getById, list, setStatus, setPreferences, getIdCard };
