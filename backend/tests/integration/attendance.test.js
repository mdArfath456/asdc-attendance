const request = require('supertest');
const db = require('../helpers/db');
const f = require('../helpers/factory');
const app = require('../../src/app');
const AttendanceSession = require('../../src/modules/attendance/attendanceSession.model');
const AttendanceRecord = require('../../src/modules/attendance/attendanceRecord.model');
const Enrollment = require('../../src/modules/enrollments/enrollment.model');
const AuditLog = require('../../src/modules/audit/auditLog.model');

let admin; let trainer; let otherTrainer; let noManageTrainer; let course;
beforeAll(async () => {
  await db.connect();
  admin = await f.createUser('ADMIN');
  trainer = await f.createUser('TRAINER');
  otherTrainer = await f.createUser('TRAINER');
  noManageTrainer = await f.createUser('TRAINER');
  course = await f.createCourse();
});
afterAll(db.disconnect);

// A fresh batch with 3 enrolled students and an assigned trainer.
async function scenario() {
  const batch = await f.createBatch(course);
  const students = [await f.createUser('STUDENT'), await f.createUser('STUDENT'), await f.createUser('STUDENT')];
  for (const s of students) await f.enroll(s, batch);
  await f.assignTrainer(trainer, batch, true);
  await f.assignTrainer(noManageTrainer, batch, false);
  return { batch, students };
}
const start = (user, batch, body = {}) => request(app).post(`/api/v1/batches/${batch._id}/attendance-sessions`).set('Authorization', f.auth(user)).send(body);
const scan = (user, token, extra = {}) => request(app).post('/api/v1/attendance/check-in').set('Authorization', f.auth(user)).send({ token, ...extra });
const close = (user, sid) => request(app).post(`/api/v1/attendance-sessions/${sid}/close`).set('Authorization', f.auth(user));
async function open(user = admin) {
  const sc = await scenario();
  const res = await start(user, sc.batch);
  return { ...sc, res, sessionId: res.body.data.session._id, token: res.body.data.qr.token };
}

describe('session start / authorisation', () => {
  test('3. admin and assigned (authorised) trainer can start; QR token returned', async () => {
    const a = await open(admin);
    expect(a.res.status).toBe(201);
    expect(a.res.body.data.session.status).toBe('OPEN');
    const sc = await scenario();
    expect((await start(trainer, sc.batch)).status).toBe(201);
  });
  test('7. students, unassigned trainers and trainers without manage rights cannot start/rotate/close', async () => {
    const { batch, students, sessionId } = await open(admin);
    expect((await start(students[0], batch)).status).toBe(403);
    expect((await start(otherTrainer, batch)).status).toBe(403);
    expect((await start(noManageTrainer, batch)).status).toBe(403);
    for (const u of [students[0], otherTrainer, noManageTrainer]) {
      expect((await request(app).post(`/api/v1/attendance-sessions/${sessionId}/qr-token`).set('Authorization', f.auth(u))).status).toBe(403);
      expect((await close(u, sessionId)).status).toBe(403);
    }
  });
  test('only one OPEN session per batch (409)', async () => {
    const { batch } = await open(admin);
    const again = await start(admin, batch);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SESSION_ALREADY_OPEN');
  });
  test('unauthenticated requests are rejected', async () => {
    expect((await request(app).post('/api/v1/attendance/check-in').send({ token: 'x'.repeat(20) })).status).toBe(401);
  });
});

describe('check-in', () => {
  test('4. enrolled student checks in PRESENT; LATE after threshold', async () => {
    const { students, token, sessionId } = await open();
    const r = await scan(students[0], token);
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe('PRESENT');
    await AttendanceSession.updateOne({ _id: sessionId }, { actualStartTime: new Date(Date.now() - 20 * 60000) });
    const late = await scan(students[1], token);
    expect(late.body.data.status).toBe('LATE');
  });
  test('4/5. previous token accepted inside grace window, rejected after; stale versions expired', async () => {
    const { students, token, sessionId } = await open();
    const rotate = () => request(app).post(`/api/v1/attendance-sessions/${sessionId}/qr-token`).set('Authorization', f.auth(admin));
    const age = (ms) => AttendanceSession.updateOne({ _id: sessionId }, { lastRotatedAt: new Date(Date.now() - ms) });
    await age(5000); // allow rotation (beyond the 2s idempotence window)
    const v2 = (await rotate()).body.data;
    expect(v2.version).toBe(2);
    expect((await scan(students[0], token)).status).toBe(201); // v1 inside grace (just rotated)
    await age(11000);
    const late = await scan(students[1], token); // v1, 11s after rotation -> expired
    expect(late.status).toBe(400);
    expect(late.body.error.code).toBe('QR_EXPIRED');
    expect((await scan(students[1], v2.token)).status).toBe(201); // v2 still valid
    await age(5000);
    await rotate();
    await age(5000);
    await rotate(); // now at v4; v1 is two versions behind
    const stale = await scan(students[2], token);
    expect(stale.body.error.code).toBe('QR_EXPIRED');
  });
  test('forged / garbage tokens are QR_INVALID', async () => {
    const { students, token } = await open();
    expect((await scan(students[0], token.slice(0, -3) + 'abc')).body.error.code).toBe('QR_INVALID');
    expect((await scan(students[0], 'not-a-real-token')).body.error.code).toBe('QR_INVALID');
  });
  test('6. token from Batch A rejected for a student enrolled only in Batch B', async () => {
    const { token } = await open();
    const outsider = await f.createUser('STUDENT');
    const batchB = await f.createBatch(course);
    await f.enroll(outsider, batchB);
    const res = await scan(outsider, token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('BATCH_MISMATCH');
  });
  test('8. studentId in payload is rejected; identity always comes from the JWT', async () => {
    const { students, token, sessionId } = await open();
    const res = await scan(students[0], token, { studentId: String(students[1]._id) });
    expect(res.status).toBe(400);
    expect(await AttendanceRecord.countDocuments({ sessionId })).toBe(0);
  });
  test('inactive enrollment cannot check in (ENROLLMENT_INELIGIBLE)', async () => {
    const { students, token } = await open();
    await Enrollment.updateOne({ studentId: students[0]._id }, { status: 'DROPPED' });
    const res = await scan(students[0], token);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ENROLLMENT_INELIGIBLE');
  });
  test('10. repeated and concurrent scans create exactly one record; duplicates get 409', async () => {
    const { students, token, sessionId } = await open();
    const results = await Promise.all(Array.from({ length: 6 }, () => scan(students[0], token)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(await AttendanceRecord.countDocuments({ sessionId, studentId: students[0]._id })).toBe(1);
  });
  test('14. QR rotation increments metadata without creating sessions', async () => {
    const { sessionId } = await open();
    const before = await AttendanceSession.countDocuments();
    for (let i = 0; i < 3; i += 1) {
      await AttendanceSession.updateOne({ _id: sessionId }, { lastRotatedAt: new Date(Date.now() - 5000) });
      await request(app).post(`/api/v1/attendance-sessions/${sessionId}/qr-token`).set('Authorization', f.auth(admin));
    }
    expect(await AttendanceSession.countDocuments()).toBe(before);
    expect((await AttendanceSession.findById(sessionId)).currentTokenVersion).toBe(4);
  });
});

describe('closing, corrections, history', () => {
  test('11. closing rejects further scans and auto-creates ABSENT records', async () => {
    const { students, token, sessionId } = await open();
    await scan(students[0], token);
    const res = await close(admin, sessionId);
    expect(res.status).toBe(200);
    expect(res.body.data.absentCreated).toBe(2);
    const recs = await AttendanceRecord.find({ sessionId }).lean();
    expect(recs).toHaveLength(3);
    expect(recs.filter((r) => r.status === 'ABSENT' && r.recordedMethod === 'SYSTEM_AUTO_ABSENT')).toHaveLength(2);
    const late = await scan(students[1], token);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('SESSION_CLOSED');
    expect((await close(admin, sessionId)).status).toBe(409);
    // existing PRESENT record untouched
    expect((await AttendanceRecord.findOne({ sessionId, studentId: students[0]._id })).status).toBe('PRESENT');
  });
  test('13. manual correction requires a reason and writes an AuditLog atomically', async () => {
    const { students, sessionId, token } = await open();
    await scan(students[0], token);
    await close(admin, sessionId);
    const rec = await AttendanceRecord.findOne({ sessionId, studentId: students[1]._id });
    const patch = (user, body) => request(app).patch(`/api/v1/attendance-records/${rec._id}`).set('Authorization', f.auth(user)).send(body);
    expect((await patch(admin, { status: 'EXCUSED' })).status).toBe(400);
    expect((await patch(admin, { status: 'EXCUSED', reason: '  ' })).status).toBe(400);
    expect((await patch(trainer, { status: 'EXCUSED', reason: 'medical leave' })).status).toBe(403);
    expect((await patch(students[1], { status: 'PRESENT', reason: 'let me in please' })).status).toBe(403);
    expect(await AuditLog.countDocuments({ entityId: rec._id })).toBe(0);
    const ok = await patch(admin, { status: 'EXCUSED', reason: 'Medical leave (certificate)' });
    expect(ok.status).toBe(200);
    const log = await AuditLog.findOne({ entityId: rec._id, action: 'ATTENDANCE_CORRECTED' });
    expect(log).toMatchObject({ previousStatus: 'ABSENT', newStatus: 'EXCUSED', reason: 'Medical leave (certificate)' });
    expect(String(log.actorId)).toBe(String(admin._id));
    await expect(AuditLog.updateOne({ _id: log._id }, { reason: 'tampered' })).rejects.toThrow(/immutable/);
  });
  test('corrections are rejected on sessions that are still OPEN', async () => {
    const { students, token, sessionId } = await open();
    await scan(students[0], token);
    const rec = await AttendanceRecord.findOne({ sessionId });
    const res = await request(app).patch(`/api/v1/attendance-records/${rec._id}`).set('Authorization', f.auth(admin)).send({ status: 'ABSENT', reason: 'testing open' });
    expect(res.status).toBe(409);
  });
  test('12. transfer keeps Batch A history on the old enrollment and links new scans to Batch B', async () => {
    const a = await open();
    const student = a.students[0];
    await scan(student, a.token);
    await close(admin, a.sessionId);
    const oldEnroll = await Enrollment.findOne({ studentId: student._id, batchId: a.batch._id });

    const batchB = await f.createBatch(course);
    const t = await request(app).post(`/api/v1/enrollments/${oldEnroll._id}/transfer`).set('Authorization', f.auth(admin)).send({ targetBatchId: String(batchB._id), reason: 'schedule change' });
    expect(t.status).toBe(200);
    const newEnrollId = t.body.data.current._id;
    expect((await Enrollment.findById(oldEnroll._id)).status).toBe('TRANSFERRED');

    const b = await start(admin, batchB);
    const res = await scan(student, b.body.data.qr.token);
    expect(res.status).toBe(201);
    const recA = await AttendanceRecord.findOne({ sessionId: a.sessionId, studentId: student._id });
    const recB = await AttendanceRecord.findOne({ sessionId: b.body.data.session._id, studentId: student._id });
    expect(String(recA.enrollmentId)).toBe(String(oldEnroll._id));
    expect(String(recB.enrollmentId)).toBe(newEnrollId);
    // old batch token no longer works for this student
    const hist = await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(student));
    expect(hist.body.data.enrollments).toHaveLength(2);
  });
  test('9. students only see their own history; staff and query overrides are blocked', async () => {
    const { students, token, sessionId } = await open();
    await scan(students[0], token);
    await close(admin, sessionId);
    const mine = await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(students[0]));
    expect(mine.status).toBe(200);
    expect(mine.body.data.enrollments[0].summary.present).toBe(1);
    expect(mine.body.data.enrollments[0].summary.percentage).toBe(100);
    const other = await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(students[1]));
    expect(other.body.data.enrollments[0].summary).toMatchObject({ present: 0, absent: 1, percentage: 0 });
    const spoof = await request(app).get(`/api/v1/attendance/my-history?studentId=${students[0]._id}`).set('Authorization', f.auth(students[1]));
    expect(spoof.status).toBe(400);
    expect((await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(admin))).status).toBe(403);
  });
  test('cancelled sessions are excluded from percentages', async () => {
    const sc = await scenario();
    const s1 = await start(admin, sc.batch);
    await scan(sc.students[0], s1.body.data.qr.token);
    await close(admin, s1.body.data.session._id);
    const s2 = await start(admin, sc.batch);
    const cancel = await request(app).post(`/api/v1/attendance-sessions/${s2.body.data.session._id}/cancel`).set('Authorization', f.auth(admin)).send({ reason: 'public holiday' });
    expect(cancel.status).toBe(200);
    const hist = await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(sc.students[0]));
    expect(hist.body.data.enrollments[0].summary.percentage).toBe(100);
  });
});

describe('reports and secret hygiene', () => {
  test('admin report/export work; trainers are scoped; students blocked', async () => {
    const { batch, students, token, sessionId } = await open();
    await scan(students[0], token);
    await close(admin, sessionId);
    const rep = await request(app).get(`/api/v1/attendance/reports?batchId=${batch._id}`).set('Authorization', f.auth(admin));
    expect(rep.status).toBe(200);
    expect(rep.body.data.total).toBe(3);
    const pct = Object.fromEntries(rep.body.data.items.map((r) => [r.studentId, r.percentage]));
    expect(pct[String(students[0]._id)]).toBe(100);
    expect(pct[String(students[1]._id)]).toBe(0);
    const csv = await request(app).get(`/api/v1/attendance/reports/export?batchId=${batch._id}&format=csv`).set('Authorization', f.auth(admin));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect((await request(app).get(`/api/v1/attendance/reports?batchId=${batch._id}`).set('Authorization', f.auth(otherTrainer))).status).toBe(403);
    expect((await request(app).get(`/api/v1/attendance/reports?batchId=${batch._id}`).set('Authorization', f.auth(trainer))).status).toBe(200);
    expect((await request(app).get('/api/v1/attendance/reports/export').set('Authorization', f.auth(trainer))).status).toBe(403);
    expect((await request(app).get('/api/v1/attendance/reports').set('Authorization', f.auth(students[0]))).status).toBe(403);
    const sum = await request(app).get(`/api/v1/attendance/summary?batchId=${batch._id}`).set('Authorization', f.auth(admin));
    expect(sum.body.data.sessions.closed).toBe(1);
  });
  test('15. responses never contain secrets or hashes', async () => {
    const { res, sessionId } = await open();
    const rec = await request(app).get(`/api/v1/attendance-sessions/${sessionId}/records`).set('Authorization', f.auth(admin));
    const users = await request(app).get('/api/v1/users').set('Authorization', f.auth(admin));
    const blob = JSON.stringify([res.body, rec.body, users.body]);
    expect(blob).not.toContain(process.env.QR_SIGNING_SECRET);
    expect(blob).not.toContain(process.env.JWT_ACCESS_SECRET);
    expect(blob).not.toMatch(/passwordHash|tokenHash/);
  });
  test('public catalogue exposes only public course fields; private routes are noindex', async () => {
    await f.createCourse({ isPublic: true });
    const pub = await request(app).get('/api/v1/courses/public');
    expect(pub.status).toBe(200);
    expect(JSON.stringify(pub.body)).not.toMatch(/createdBy|batch|attendance/i);
    expect(pub.headers['x-robots-tag']).toMatch(/noindex/);
    expect((await request(app).get('/sitemap.xml')).text).toContain('<urlset');
    expect((await request(app).get('/robots.txt')).text).toContain('Disallow: /api/');
  });
});
