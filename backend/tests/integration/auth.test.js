jest.mock('../../src/modules/auth/google.verifier', () => ({ verifyGoogleIdToken: jest.fn() }));
const request = require('supertest');
const db = require('../helpers/db');
const f = require('../helpers/factory');
const { verifyGoogleIdToken } = require('../../src/modules/auth/google.verifier');
const app = require('../../src/app');
const User = require('../../src/modules/users/user.model');
const RefreshToken = require('../../src/modules/auth/refreshToken.model');
const AuditLog = require('../../src/modules/audit/auditLog.model');
const Course = require('../../src/modules/courses/course.model');
const Batch = require('../../src/modules/batches/batch.model');
const Enrollment = require('../../src/modules/enrollments/enrollment.model');
const { bootstrapAdmin } = require('../../src/modules/auth/adminBootstrap.service');
const courseService = require('../../src/modules/courses/courses.service');

const FAKE = 'x'.repeat(40);
let admin;
beforeAll(async () => {
  await db.connect();
  admin = await bootstrapAdmin();
});
afterAll(db.disconnect);

describe('local auth', () => {
  test('login succeeds, sets httpOnly refresh cookie, never leaks hashes', async () => {
    const u = await f.createUser('STUDENT');
    const res = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenHash|\$2[aby]\$/);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/asdc_rt=/);
    expect(cookie).toMatch(/HttpOnly/i);
  });
  test('wrong password and unknown email give the same 401', async () => {
    const u = await f.createUser('STUDENT');
    const a = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'nope-nope' });
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@asdc.test', password: 'nope-nope' });
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body.error.code).toBe(b.body.error.code);
  });
  test('login normalizes email and rejects missing fields with 400', async () => {
    const u = await f.createUser('STUDENT');
    const valid = await request(app).post('/api/v1/auth/login').send({ email: ` ${u.email.toUpperCase()} `, password: 'Passw0rd!123' });
    expect(valid.status).toBe(200);
    const missing = await request(app).post('/api/v1/auth/login').send({ email: u.email });
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
  });
  test('password registration always creates a student and rejects role injection', async () => {
    const course = await f.createCourse();
    const body = { name: 'New Learner', email: 'learner@example.test', password: 'StrongPassword9!', courseId: String(course._id) };
    const registered = await request(app).post('/api/v1/auth/register').send(body);
    expect(registered.status).toBe(201);
    expect(registered.body.data.user.role).toBe('STUDENT');
    expect(await Enrollment.countDocuments({ studentId: registered.body.data.user.id, courseId: course._id, status: 'ACTIVE' })).toBe(1);
    const injected = await request(app).post('/api/v1/auth/register').send({ ...body, email: 'another@example.test', role: 'ADMIN' });
    expect(injected.status).toBe(400);
    expect(injected.body.error.code).toBe('VALIDATION_ERROR');
    const reserved = await request(app).post('/api/v1/auth/register').send({ ...body, email: process.env.ADMIN_EMAIL });
    expect(reserved.status).toBe(403);
  });
  test('Other course requests create a student without an enrollment', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'Requested Course Learner',
      email: 'request-course@example.test',
      password: 'StrongPassword9!',
      requestedCourseName: '  Advanced Web Systems  ',
    });
    expect(response.status).toBe(201);
    expect(response.body.data.user.requestedCourseName).toBe('Advanced Web Systems');
    expect(await Enrollment.countDocuments({ studentId: response.body.data.user.id })).toBe(0);
    expect((await request(app).post('/api/v1/auth/register').send({
      name: 'Markup Learner', email: 'markup@example.test', password: 'StrongPassword9!', requestedCourseName: '<b>Course</b>',
    })).status).toBe(400);
  });
  test('suspended user cannot use an existing access token', async () => {
    const u = await f.createUser('STUDENT');
    const header = f.auth(u);
    await User.updateOne({ _id: u._id }, { status: 'SUSPENDED' });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', header);
    expect(res.status).toBe(401);
  });
  test('refresh rotates the token; reusing an old one revokes the family', async () => {
    const u = await f.createUser('STUDENT');
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    const c1 = login.headers['set-cookie'][0].split(';')[0];
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(r1.status).toBe(200);
    const c2 = r1.headers['set-cookie'][0].split(';')[0];
    expect(c2).not.toBe(c1);
    // age the revoked token beyond the 10s race window, then replay it
    await RefreshToken.updateMany({ userId: u._id, revokedAt: { $ne: null } }, { revokedAt: new Date(Date.now() - 60000), rotatedAt: new Date(Date.now() - 60000) });
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', c1);
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    const afterRevoke = await request(app).post('/api/v1/auth/refresh').set('Cookie', c2);
    expect(afterRevoke.status).toBe(401);
  });
  test('parallel refresh requests return the same successor and preserve the cookie', async () => {
    const u = await f.createUser('STUDENT');
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    const oldCookie = login.headers['set-cookie'][0].split(';')[0];
    const refresh = () => request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie).set('Origin', 'http://localhost:5173');
    const [first, second] = await Promise.all([refresh(), refresh()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const nextCookie = first.headers['set-cookie'][0].split(';')[0];
    expect(second.headers['set-cookie'][0].split(';')[0]).toBe(nextCookie);
    expect(nextCookie).not.toBe(oldCookie);
    expect(first.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(second.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', nextCookie).set('Origin', 'http://localhost:5173')).status).toBe(200);
  });
  test('parallel admin refresh requests preserve the session cookie', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(login.status).toBe(200);
    const oldCookie = login.headers['set-cookie'][0].split(';')[0];
    const refresh = () => request(app).post('/api/v1/auth/refresh').set('Cookie', oldCookie).set('Origin', 'http://localhost:5173');
    const [first, second] = await Promise.all([refresh(), refresh()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['set-cookie'][0].split(';')[0]).toBe(second.headers['set-cookie'][0].split(';')[0]);
    expect(first.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(second.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
  });
  test('refresh race errors do not clear a valid cookie', async () => {
    const u = await f.createUser('STUDENT');
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const old = await RefreshToken.findOne({ userId: u._id, revokedAt: null });
    await RefreshToken.updateOne({ _id: old._id }, { $set: { revokedAt: new Date(), rotatedAt: new Date(), successorTokenEncrypted: undefined } });
    const response = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'http://localhost:5173');
    expect(response.status).toBe(409);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  test('first visit without a refresh cookie is unauthenticated', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_REFRESH_TOKEN');
  });
  test('refresh rejects an untrusted browser origin without consuming the cookie', async () => {
    const u = await f.createUser('STUDENT');
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const rejected = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'https://untrusted.example');
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
    const accepted = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie).set('Origin', 'http://localhost:5173');
    expect(accepted.status).toBe(200);
  });
  test('logout revokes the refresh token', async () => {
    const u = await f.createUser('STUDENT');
    const login = await request(app).post('/api/v1/auth/login').send({ email: u.email, password: 'Passw0rd!123' });
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(200);
    const afterLogout = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(afterLogout.status).toBe(401);
  });
});

describe('Google Sign-In', () => {
  test('1. pre-registered user: first login links googleId, audits, returns session', async () => {
    const u = await f.createUser('STUDENT', { authProviders: ['GOOGLE'], passwordHash: undefined });
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-111', email: u.email, emailVerified: true, picture: 'http://p/x.png' });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: FAKE });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    const fresh = await User.findById(u._id);
    expect(fresh.googleId).toBe('sub-111');
    expect(fresh.authProviders).toContain('GOOGLE');
    expect(await AuditLog.countDocuments({ action: 'GOOGLE_LINKED', entityId: u._id })).toBe(1);
  });
  test('subsequent login matches by googleId even if the Google email differs', async () => {
    const u = await f.createUser('STUDENT', { googleId: 'sub-222', authProviders: ['GOOGLE'], passwordHash: undefined });
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-222', email: 'renamed@gmail.test', emailVerified: true });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: FAKE });
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(String(u._id));
  });
  test('unregistered Google account starts the registration flow without creating a user', async () => {
    const before = await User.countDocuments();
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-333', email: 'stranger@gmail.test', emailVerified: true, name: 'New Student' });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: FAKE });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGISTRATION_REQUIRED');
    expect(res.body.message).toBe('Complete registration to continue');
    expect(await User.countDocuments()).toBe(before);
  });
  test('unverified email or invalid token -> 401', async () => {
    const u = await f.createUser('STUDENT');
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-444', email: u.email, emailVerified: false });
    expect((await request(app).post('/api/v1/auth/google').send({ idToken: FAKE })).status).toBe(401);
    verifyGoogleIdToken.mockRejectedValueOnce(new Error('bad signature'));
    expect((await request(app).post('/api/v1/auth/google').send({ idToken: FAKE })).status).toBe(401);
  });
  test('missing Google credential returns a validation error', async () => {
    const res = await request(app).post('/api/v1/auth/google').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
  test('Google self-registration creates a student with an active course enrollment', async () => {
    const course = await f.createCourse();
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'registration-sub', email: 'google-user@example.test', emailVerified: true, name: 'Google Learner' });
    const res = await request(app).post('/api/v1/auth/register-google').send({ idToken: FAKE, courseId: String(course._id) });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('STUDENT');
    expect(await Enrollment.countDocuments({ studentId: res.body.data.user.id, courseId: course._id, status: 'ACTIVE' })).toBe(1);
  });
  test('admin-only Google sign-in rejects a verified non-admin identity', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'non-admin-sub', email: 'someone@example.test', emailVerified: true });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: FAKE, adminOnly: true });
    expect(res.status).toBe(403);
    expect(res.body.message).toBe('This account is not an admin');
  });
  test('account already linked to a different Google sub is rejected', async () => {
    const u = await f.createUser('STUDENT', { googleId: 'sub-original' });
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-attacker', email: u.email, emailVerified: true });
    const res = await request(app).post('/api/v1/auth/google').send({ idToken: FAKE });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_ACCOUNT_MISMATCH');
  });
  test('inactive pre-registered user cannot sign in with Google', async () => {
    const u = await f.createUser('STUDENT', { status: 'INACTIVE' });
    verifyGoogleIdToken.mockResolvedValueOnce({ sub: 'sub-555', email: u.email, emailVerified: true });
    expect((await request(app).post('/api/v1/auth/google').send({ idToken: FAKE })).status).toBe(403);
  });
});

describe('administrator bootstrap and trainer assignment', () => {
  test('only ADMIN_EMAIL can be admin, bootstrap is idempotent, and optional password works', async () => {
    const first = await bootstrapAdmin();
    const second = await bootstrapAdmin();
    expect(String(first._id)).toBe(String(second._id));
    expect(await User.countDocuments({ role: 'ADMIN' })).toBe(1);
    expect(second.email).toBe(process.env.ADMIN_EMAIL);
    const login = await request(app).post('/api/v1/auth/login').send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain(process.env.ADMIN_PASSWORD);
    const wrong = await request(app).post('/api/v1/auth/login').send({ email: process.env.ADMIN_EMAIL, password: 'wrong-password-123!' });
    expect(wrong.status).toBe(401);
    const blocked = await User.create({ name: 'Role Guard', email: 'not-admin@example.test', role: 'ADMIN', authProviders: ['GOOGLE'] }).catch((e) => e);
    expect(blocked).toBeInstanceOf(Error);
  });

  test('trainer assignment creates by email, accepts trainers, and rejects active students', async () => {
    const course = await f.createCourse();
    const path = `/api/v1/courses/${course._id}/trainers`;
    const newTrainer = await request(app).post(path).set('Authorization', f.auth(admin)).send({ email: 'first-trainer@example.test' });
    expect(newTrainer.status).toBe(201);
    expect(newTrainer.body.data.trainer.role).toBe('TRAINER');

    const trainer = await f.createUser('TRAINER');
    const assigned = await request(app).post(path).set('Authorization', f.auth(admin)).send({ email: trainer.email });
    expect(assigned.status).toBe(201);
    const duplicate = await request(app).post(path).set('Authorization', f.auth(admin)).send({ email: trainer.email });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.message).toBe('Trainer is already assigned');

    const student = await f.createUser('STUDENT');
    const batch = await courseService.ensureCourseBatch(course);
    await Enrollment.create({ studentId: student._id, batchId: batch._id, courseId: course._id });
    const rejected = await request(app).post(path).set('Authorization', f.auth(admin)).send({ email: student.email });
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe('STUDENT_HAS_ACTIVE_ENROLLMENTS');
    expect(rejected.body.message).toBe('This person is a student with active enrollments');
    const adminAddress = await request(app).post(path).set('Authorization', f.auth(admin)).send({ email: process.env.ADMIN_EMAIL });
    expect(adminAddress.status).toBe(400);
    expect(adminAddress.body.error.code).toBe('ADMIN_EMAIL_RESERVED');
    expect(adminAddress.body.message).toBe('This is the admin email and cannot be assigned as a trainer');
  });

  test('requested-course students can be enrolled by the admin into an existing course', async () => {
    const learner = await User.create({
      name: 'Pending Learner', email: 'pending@example.test', role: 'STUDENT', authProviders: ['GOOGLE'],
      requestedCourseName: 'Web Systems',
    });
    const course = await f.createCourse({ name: 'Web Systems' });
    const response = await request(app).post(`/api/v1/courses/${course._id}/enroll-requested`)
      .set('Authorization', f.auth(admin)).send({});
    expect(response.status).toBe(200);
    expect(response.body.data.enrolledCount).toBe(1);
    expect(await Enrollment.countDocuments({ studentId: learner._id, courseId: course._id, status: 'ACTIVE' })).toBe(1);
    expect((await User.findById(learner._id)).requestedCourseName).toBeUndefined();
  });

  test('trainers list only their assigned courses', async () => {
    const trainer = await f.createUser('TRAINER');
    const assignedCourse = await f.createCourse();
    const unassignedCourse = await f.createCourse();
    const batch = await courseService.ensureCourseBatch(assignedCourse);
    await f.assignTrainer(trainer, batch, true);
    const res = await request(app).get('/api/v1/courses').set('Authorization', f.auth(trainer));
    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => String(c._id))).toEqual([String(assignedCourse._id)]);
    expect(res.body.data.map((c) => String(c._id))).not.toContain(String(unassignedCourse._id));
  });

  test('admin password is never present in API responses', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', f.auth(admin));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(process.env.ADMIN_PASSWORD);
  });

  test('admin and trainer cannot use student-only routes; non-admin roles cannot use admin routes', async () => {
    const student = await f.createUser('STUDENT');
    const trainer = await f.createUser('TRAINER');
    const course = await f.createCourse();
    for (const user of [admin, trainer]) {
      expect((await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(user))).status).toBe(403);
      expect((await request(app).post('/api/v1/enrollments/join').set('Authorization', f.auth(user)).send({ courseId: String(course._id) })).status).toBe(403);
      expect((await request(app).post('/api/v1/attendance/check-in').set('Authorization', f.auth(user)).send({ token: 'invalid' })).status).toBe(403);
    }
    for (const user of [student, trainer]) {
      expect((await request(app).get('/api/v1/courses/students').set('Authorization', f.auth(user))).status).toBe(403);
      expect((await request(app).get('/api/v1/audit-logs').set('Authorization', f.auth(user))).status).toBe(403);
    }
  });
});

describe('user provisioning RBAC', () => {
  test('admin cannot create accounts through the removed generic user endpoint', async () => {
    const student = await f.createUser('STUDENT');
    expect((await request(app).post('/api/v1/users').set('Authorization', f.auth(admin)).send({ name: 'New Admin' })).status).toBe(404);
    expect((await request(app).get('/api/v1/users').set('Authorization', f.auth(student))).status).toBe(403);
  });
});
