const ApiError = require('../../utils/ApiError');
const { slugify } = require('../../utils/zodHelpers');
const Course = require('./course.model');
const audit = require('../audit/audit.service');
const Batch = require('../batches/batch.model');
const TrainerAssignment = require('../batches/trainerAssignment.model');
const User = require('../users/user.model');
const Enrollment = require('../enrollments/enrollment.model');

const PUBLIC_FIELDS = 'name code slug description durationHours updatedAt';

async function ensureCourseBatch(course, createdBy) {
  let batch = await Batch.findOne({ courseId: course._id, isCourseGroup: true }).select('+isCourseGroup');
  if (batch) return batch;
  try {
    return await Batch.create({
      courseId: course._id,
      name: course.name,
      startDate: new Date(),
      status: 'ACTIVE',
      isCourseGroup: true,
      createdBy,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    batch = await Batch.findOne({ courseId: course._id, isCourseGroup: true }).select('+isCourseGroup');
    if (!batch) throw error;
    return batch;
  }
}

async function list(user) {
  let courses;
  if (user.role !== 'TRAINER') {
    courses = await Course.find().sort({ name: 1 });
  } else {
    const assignments = await TrainerAssignment.find({ trainerId: user.id }).select('batchId').lean();
    const batches = await Batch.find({ _id: { $in: assignments.map((a) => a.batchId) } }).select('courseId').lean();
    courses = await Course.find({ _id: { $in: batches.map((b) => b.courseId) } }).sort({ name: 1 });
  }
  const batches = await Batch.find({ courseId: { $in: courses.map((c) => c._id) }, isCourseGroup: true }).select('+isCourseGroup courseId').lean();
  const batchByCourse = new Map(batches.map((batch) => [String(batch.courseId), String(batch._id)]));
  const counts = await Enrollment.aggregate([
    { $match: { courseId: { $in: courses.map((course) => course._id) }, status: 'ACTIVE' } },
    { $group: { _id: '$courseId', count: { $sum: 1 } } },
  ]);
  const countByCourse = new Map(counts.map((row) => [String(row._id), row.count]));
  return courses.map((course) => ({
    ...course.toJSON(),
    batchId: batchByCourse.get(String(course._id)),
    enrolledCount: countByCourse.get(String(course._id)) || 0,
  }));
}
const listPublic = () => Course.find({ isPublic: true, status: 'ACTIVE' }).select(PUBLIC_FIELDS).sort({ name: 1 }).lean();
const listActive = () => Course.find({ status: 'ACTIVE' }).select('_id name code').sort({ name: 1 }).lean();
async function getPublicBySlug(slug) {
  const c = await Course.findOne({ slug, isPublic: true, status: 'ACTIVE' }).select(PUBLIC_FIELDS).lean();
  if (!c) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  return c;
}

async function create(actor, input) {
  const course = await Course.create({ ...input, slug: input.slug || slugify(input.name), createdBy: actor.id });
  await ensureCourseBatch(course, actor.id);
  await audit.log({ actorId: actor.id, action: 'COURSE_CREATED', entityType: 'Course', entityId: course._id });
  return course;
}

async function update(actor, courseId, input) {
  const course = await Course.findByIdAndUpdate(courseId, { $set: input }, { new: true, runValidators: true });
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  await audit.log({ actorId: actor.id, action: 'COURSE_UPDATED', entityType: 'Course', entityId: course._id, metadata: { fields: Object.keys(input) } });
  return course;
}

async function getDetails(courseId, actor) {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  const batch = await ensureCourseBatch(course);
  if (actor.role === 'TRAINER') {
    const assigned = await TrainerAssignment.exists({ batchId: batch._id, trainerId: actor.id });
    if (!assigned) throw new ApiError(403, 'COURSE_FORBIDDEN', 'You are not assigned to this course');
  }
  const [students, trainers] = await Promise.all([
    Enrollment.find({ batchId: batch._id, status: 'ACTIVE' }).populate('studentId', 'name email').sort({ enrolledAt: 1 }).lean(),
    TrainerAssignment.find({ batchId: batch._id }).populate('trainerId', 'name email status').lean(),
  ]);
  return {
    course,
    batchId: String(batch._id),
    students: students.map((e) => ({ enrollmentId: String(e._id), student: e.studentId })),
    trainers: trainers.map((a) => ({ assignmentId: String(a._id), trainer: a.trainerId, canManageSessions: a.canManageSessions })),
  };
}

async function listGroupedStudents(search = '') {
  const rx = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
  const courses = await Course.find().sort({ name: 1 }).lean();
  const batches = await Batch.find({ isCourseGroup: true }).select('+isCourseGroup courseId').lean();
  const grouped = await Promise.all(courses.map(async (course) => {
    const batch = batches.find((row) => String(row.courseId) === String(course._id));
    if (!batch) return { course: { id: String(course._id), name: course.name, code: course.code }, count: 0, students: [] };
    const enrollments = await Enrollment.find({ batchId: batch._id, status: 'ACTIVE' }).populate('studentId', 'name email').sort({ enrolledAt: 1 }).lean();
    const students = enrollments.filter((row) => row.studentId && (!rx || rx.test(row.studentId.name) || rx.test(row.studentId.email)))
      .map((row) => ({ enrollmentId: String(row._id), student: row.studentId }));
    return { course: { id: String(course._id), name: course.name, code: course.code }, count: students.length, students };
  }));
  return grouped;
}

async function listRequestedStudents(search = '') {
  const filters = { role: 'STUDENT', requestedCourseName: { $exists: true, $ne: '' } };
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filters.$or = [{ name: rx }, { email: rx }, { requestedCourseName: rx }];
  }
  const users = await User.find(filters).select('name email requestedCourseName createdAt').sort({ requestedCourseName: 1, name: 1 }).lean();
  const groups = new Map();
  for (const user of users) {
    const key = user.requestedCourseName.trim().toLocaleLowerCase();
    if (!groups.has(key)) groups.set(key, { requestedCourseName: user.requestedCourseName, students: [] });
    groups.get(key).students.push({ id: String(user._id), name: user.name, email: user.email });
  }
  return [...groups.values()].map((group) => ({ ...group, count: group.students.length }));
}

async function enrollRequestedStudents(actor, courseId, requestedCourseName) {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  const requestedName = String(requestedCourseName || course.name).trim();
  if (!requestedName) throw new ApiError(400, 'REQUESTED_COURSE_REQUIRED', 'Choose a requested course name');
  const candidates = await User.find({
    role: 'STUDENT',
    requestedCourseName: { $regex: `^${requestedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
  }).select('_id status requestedCourseName');
  const batch = await ensureCourseBatch(course, actor.id);
  const enrolled = [];
  for (const student of candidates) {
    if (student.status !== 'ACTIVE') continue;
    const alreadyEnrolled = await Enrollment.exists({ studentId: student._id, courseId: course._id, status: 'ACTIVE' });
    if (alreadyEnrolled) {
      student.requestedCourseName = undefined;
      await student.save();
      continue;
    }
    const enrollment = await Enrollment.create({
      studentId: student._id,
      batchId: batch._id,
      courseId: course._id,
      createdBy: actor.id,
    });
    student.requestedCourseName = undefined;
    await student.save();
    await audit.log({
      actorId: actor.id,
      action: 'REQUESTED_STUDENT_ENROLLED',
      entityType: 'Enrollment',
      entityId: enrollment._id,
      metadata: { studentId: String(student._id), courseId: String(course._id), requestedCourseName: requestedName },
    });
    enrolled.push(enrollment);
  }
  return { enrolledCount: enrolled.length, courseId: String(course._id) };
}

async function assignTrainer(actor, courseId, email) {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  const normalized = email.trim().toLowerCase();
  const env = require('../../config/env');
  if (normalized === env.ADMIN_EMAIL) throw new ApiError(400, 'ADMIN_EMAIL_RESERVED', 'This is the admin email and cannot be assigned as a trainer');
  const batch = await ensureCourseBatch(course, actor.id);
  let trainer = await User.findOne({ email: normalized }).select('+passwordHash');
  if (!trainer) {
    try {
      trainer = await User.create({
        name: normalized.split('@')[0],
        email: normalized,
        role: 'TRAINER',
        authProviders: ['GOOGLE'],
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      trainer = await User.findOne({ email: normalized }).select('+passwordHash');
      if (!trainer) throw new ApiError(409, 'TRAINER_ASSIGNMENT_CONFLICT', 'This trainer account changed. Please try again.');
    }
  } else {
    if (trainer.status !== 'ACTIVE') throw new ApiError(409, 'TRAINER_ACCOUNT_INACTIVE', 'This trainer account is inactive');
    if (trainer.role === 'STUDENT') {
    const activeEnrollments = await Enrollment.countDocuments({ studentId: trainer._id, status: 'ACTIVE' });
    if (activeEnrollments) throw new ApiError(409, 'STUDENT_HAS_ACTIVE_ENROLLMENTS', 'This person is a student with active enrollments');
    trainer.role = 'TRAINER';
    trainer.authProviders = [...new Set([...trainer.authProviders, 'GOOGLE'])];
    await trainer.save();
    } else if (trainer.role !== 'TRAINER') {
    throw new ApiError(409, 'INVALID_TRAINER_ROLE', 'This account cannot be assigned as a trainer');
    }
  }
  if (trainer.status !== 'ACTIVE') throw new ApiError(409, 'TRAINER_ACCOUNT_INACTIVE', 'This trainer account is inactive');
  const existing = await TrainerAssignment.findOne({ batchId: batch._id, trainerId: trainer._id });
  if (existing) {
    if (!existing.canManageSessions) {
      existing.canManageSessions = true;
      existing.assignedBy = actor.id;
      await existing.save();
    }
    return { assignment: existing, trainer, alreadyAssigned: true };
  }
  let assignment;
  try {
    assignment = await TrainerAssignment.create({
      batchId: batch._id,
      trainerId: trainer._id,
      canManageSessions: true,
      assignedBy: actor.id,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await TrainerAssignment.findOne({ batchId: batch._id, trainerId: trainer._id });
    if (!duplicate) throw new ApiError(409, 'TRAINER_ASSIGNMENT_CONFLICT', 'Trainer assignment changed. Please try again.');
    return { assignment: duplicate, trainer, alreadyAssigned: true };
  }
  await audit.log({ actorId: actor.id, action: 'TRAINER_ASSIGNED', entityType: 'Course', entityId: course._id, metadata: { trainerId: String(trainer._id) } });
  return { assignment, trainer, alreadyAssigned: false };
}

async function removeTrainer(actor, courseId, trainerId) {
  const course = await Course.findById(courseId);
  if (!course) throw new ApiError(404, 'COURSE_NOT_FOUND', 'Course not found');
  const batch = await ensureCourseBatch(course, actor.id);
  const removed = await TrainerAssignment.findOneAndDelete({ batchId: batch._id, trainerId });
  if (!removed) throw new ApiError(404, 'ASSIGNMENT_NOT_FOUND', 'Trainer is not assigned to this course');
  await audit.log({ actorId: actor.id, action: 'TRAINER_REMOVED', entityType: 'Course', entityId: course._id, metadata: { trainerId: String(trainerId) } });
}

async function ensureAllCourseBatches() {
  const courses = await Course.find();
  for (const course of courses) await ensureCourseBatch(course);
}

module.exports = { list, listPublic, listActive, getPublicBySlug, create, update, getDetails, listGroupedStudents, listRequestedStudents, enrollRequestedStudents, assignTrainer, removeTrainer, ensureCourseBatch, ensureAllCourseBatches };
