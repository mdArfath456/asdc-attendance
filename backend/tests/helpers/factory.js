const jwt = require('jsonwebtoken');
const User = require('../../src/modules/users/user.model');
const Course = require('../../src/modules/courses/course.model');
const Batch = require('../../src/modules/batches/batch.model');
const Enrollment = require('../../src/modules/enrollments/enrollment.model');
const TrainerAssignment = require('../../src/modules/batches/trainerAssignment.model');
const { hashPassword } = require('../../src/modules/auth/password');

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n += 1)}`;

exports.createUser = async (role, overrides = {}) =>
  User.create({
    name: `${role} ${uniq()}`,
    email: role === 'ADMIN' ? process.env.ADMIN_EMAIL : `${role.toLowerCase()}-${uniq()}@asdc.test`,
    role,
    authProviders: ['LOCAL'],
    passwordHash: await hashPassword('Passw0rd!123'),
    ...overrides,
  });

exports.auth = (user) => `Bearer ${jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' })}`;

exports.createCourse = (overrides = {}) =>
  Course.create({ name: `Course ${uniq()}`, code: `C${uniq()}`, slug: `course-${uniq()}`, isPublic: true, ...overrides });

exports.createBatch = async (course, overrides = {}) =>
  Batch.create({ courseId: course._id, name: `Batch ${uniq()}`, startDate: new Date(), ...overrides });

exports.enroll = (student, batch) =>
  Enrollment.create({ studentId: student._id, batchId: batch._id, courseId: batch.courseId, enrolledAt: new Date(Date.now() - 3600000) });

exports.assignTrainer = (trainer, batch, canManageSessions = true) =>
  TrainerAssignment.create({ batchId: batch._id, trainerId: trainer._id, canManageSessions });
