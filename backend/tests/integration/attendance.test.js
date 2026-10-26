const request = require('supertest');
const db = require('../helpers/db');
const f = require('../helpers/factory');
const app = require('../../src/app');
const AttendanceSession = require('../../src/modules/attendance/attendanceSession.model');
const AttendanceRecord = require('../../src/modules/attendance/attendanceRecord.model');
const Enrollment = require('../../src/modules/enrollments/enrollment.model');
const Batch = require('../../src/modules/batches/batch.model');
const AuditLog = require('../../src/modules/audit/auditLog.model');
const sessionsService = require('../../src/modules/attendance/session.service');
const checkInService = require('../../src/modules/attendance/checkin.service');
const { sessionDateFor } = require('../../src/utils/dates');

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
  test('starting again today resumes the open session', async () => {
    const { batch, sessionId } = await open(admin);
    const again = await start(admin, batch);
    expect(again.status).toBe(200);
    expect(again.body.data.resumed).toBe(true);
    expect(again.body.data.session._id).toBe(sessionId);
    expect(again.body.data.qr.token).toBeTruthy();
  });
  test('a closed session blocks a second start on the same day', async () => {
    const { batch, sessionId } = await open(admin);
    await close(admin, sessionId);
    const again = await start(admin, batch);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SESSION_ALREADY_TAKEN_TODAY');
    expect(again.body.error.details.sessionId).toBe(sessionId);
  });
  test('staff can query today’s session while students only see their own today state', async () => {
    const { batch, students, token, sessionId } = await open();
    const staffToday = await request(app)
      .get(`/api/v1/batches/${batch._id}/attendance-sessions/today`)
      .set('Authorization', f.auth(admin));
    expect(staffToday.status).toBe(200);
    expect(String(staffToday.body.data._id)).toBe(sessionId);

    const studentToday = () => request(app)
      .get('/api/v1/attendance/today')
      .set('Authorization', f.auth(students[0]));
    expect((await studentToday()).body.data.courses[0].state).toBe('NOT_RECORDED');
    expect((await request(app).get('/api/v1/attendance/today').set('Authorization', f.auth(admin))).status).toBe(403);
    expect((await request(app).get('/api/v1/attendance/today').set('Authorization', f.auth(trainer))).status).toBe(403);
    await scan(students[0], token);
    const recorded = (await studentToday()).body.data.courses[0];
    expect(recorded.state).toBe('RECORDED');
    expect(recorded.record.status).toBe('PRESENT');
  });
  test('staff today dashboard endpoint returns only sessions in the user’s authorized scope', async () => {
    const { batch, sessionId } = await open();
    await Batch.updateOne({ _id: batch._id }, { $set: { isCourseGroup: true } });
    const url = '/api/v1/attendance-sessions/today';
    const adminResult = await request(app).get(url).set('Authorization', f.auth(admin));
    expect(adminResult.status).toBe(200);
    expect(adminResult.body.data.map((session) => String(session._id))).toContain(sessionId);

    const trainerResult = await request(app).get(url).set('Authorization', f.auth(trainer));
    expect(trainerResult.status).toBe(200);
    expect(trainerResult.body.data.map((session) => String(session._id))).toContain(sessionId);

    const otherTrainerResult = await request(app).get(url).set('Authorization', f.auth(otherTrainer));
    expect(otherTrainerResult.status).toBe(200);
    expect(otherTrainerResult.body.data).toHaveLength(0);
    expect((await request(app).get(url).set('Authorization', f.auth((await f.createUser('STUDENT'))))).status).toBe(403);
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
  test('check-in uses the active enrollment when historical inactive enrollments also exist', async () => {
    const { batch, students, token } = await open();
    const student = students[0];
    const oldEnrollment = await Enrollment.findOne({ studentId: student._id, batchId: batch._id, status: 'ACTIVE' });
    await Enrollment.updateOne({ _id: oldEnrollment._id }, { $set: { status: 'DROPPED', endedAt: new Date() } });
    const activeEnrollment = await Enrollment.create({
      studentId: student._id,
      batchId: batch._id,
      courseId: batch.courseId,
      enrolledAt: new Date(Date.now() - 60_000),
    });

    const result = await scan(student, token);

    expect(result.status).toBe(201);
    expect(String((await AttendanceRecord.findOne({ studentId: student._id })).enrollmentId)).toBe(String(activeEnrollment._id));
  });
  test('10. repeated and concurrent scans create exactly one record; duplicates get 409', async () => {
    const { students, token, sessionId } = await open();
    const results = await Promise.all(Array.from({ length: 6 }, () => scan(students[0], token)));
    const codes = results.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(5);
    expect(results.find((r) => r.status === 409).body.error.code).toBe('ALREADY_CHECKED_IN');
    expect(results.find((r) => r.status === 409).body.message).toBe('Your attendance has already been recorded for today');
    expect(await AttendanceRecord.countDocuments({ sessionId, studentId: students[0]._id })).toBe(1);
  });
  test('a student can check in once for each of two different courses', async () => {
    const first = await open();
    const student = first.students[0];
    const otherCourse = await f.createCourse();
    const otherBatch = await f.createBatch(otherCourse);
    await f.enroll(student, otherBatch);
    const second = await start(admin, otherBatch);
    expect((await scan(student, first.token)).status).toBe(201);
    expect((await scan(student, second.body.data.qr.token)).status).toBe(201);
    expect(await AttendanceRecord.countDocuments({ studentId: student._id })).toBe(2);
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
  test('student history pagination limits records while keeping full totals', async () => {
    const { batch, students } = await scenario();
    const student = students[0];
    const enrollment = await Enrollment.findOne({ studentId: student._id, batchId: batch._id });
    const dates = [new Date('2025-01-01T00:00:00.000Z'), new Date('2025-01-02T00:00:00.000Z')];
    for (const [index, sessionDate] of dates.entries()) {
      const session = await AttendanceSession.create({
        batchId: batch._id,
        courseId: batch.courseId,
        title: `History ${index + 1}`,
        sessionDate,
        scheduledStart: sessionDate,
        scheduledEnd: new Date(sessionDate.getTime() + 3600000),
        actualStartTime: sessionDate,
        actualEndTime: new Date(sessionDate.getTime() + 3600000),
        createdBy: admin._id,
        closedBy: admin._id,
        status: 'CLOSED',
        lateThresholdMinutes: 10,
        currentTokenVersion: 1,
        refreshIntervalSeconds: 15,
        gracePeriodSeconds: 10,
      });
      await AttendanceRecord.create({
        sessionId: session._id,
        enrollmentId: enrollment._id,
        studentId: student._id,
        batchId: batch._id,
        sessionDate,
        status: index === 0 ? 'PRESENT' : 'LATE',
        recordedMethod: 'QR_SCAN',
        checkInTimestamp: sessionDate,
      });
    }

    const first = await request(app).get('/api/v1/attendance/my-history?page=1&limit=1').set('Authorization', f.auth(student));
    const second = await request(app).get('/api/v1/attendance/my-history?page=2&limit=1').set('Authorization', f.auth(student));
    expect(first.status).toBe(200);
    expect(first.body.data.history).toMatchObject({ page: 1, limit: 1, total: 2, pages: 2 });
    expect(first.body.data.enrollments[0].sessions).toHaveLength(1);
    expect(second.body.data.enrollments[0].sessions).toHaveLength(1);
    expect(first.body.data.overall).toMatchObject({ present: 1, late: 1 });
    expect(first.body.data.enrollments[0].summary).toMatchObject({ present: 1, late: 1 });
  });
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
    const cancel = await request(app).post(`/api/v1/attendance-sessions/${s1.body.data.session._id}/cancel`).set('Authorization', f.auth(admin)).send({ reason: 'public holiday' });
    expect(cancel.status).toBe(200);
    expect(await AttendanceRecord.countDocuments({ sessionId: s1.body.data.session._id })).toBe(0);
    const s2 = await start(admin, sc.batch);
    expect(s2.status).toBe(201);
    await scan(sc.students[0], s2.body.data.qr.token);
    await close(admin, s2.body.data.session._id);
    const hist = await request(app).get('/api/v1/attendance/my-history').set('Authorization', f.auth(sc.students[0]));
    expect(hist.body.data.enrollments[0].summary.percentage).toBe(100);
  });
  test('reopening removes only auto-absent records and allows scanning again', async () => {
    const { students, token, sessionId } = await open();
    await scan(students[0], token);
    await close(admin, sessionId);
    const absent = await AttendanceRecord.findOne({ sessionId, studentId: students[1]._id });
    await request(app)
      .patch(`/api/v1/attendance-records/${absent._id}`)
      .set('Authorization', f.auth(admin))
      .send({ status: 'EXCUSED', reason: 'Approved absence' });
    const reopened = await request(app)
      .post(`/api/v1/attendance-sessions/${sessionId}/reopen`)
      .set('Authorization', f.auth(admin));
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.session.status).toBe('OPEN');
    expect(reopened.body.data.removedAutoAbsentRecords).toBe(1);
    expect(await AttendanceRecord.countDocuments({ sessionId, studentId: students[0]._id, recordedMethod: 'QR_SCAN' })).toBe(1);
    expect((await AttendanceRecord.findOne({ sessionId, studentId: students[1]._id })).status).toBe('EXCUSED');
    expect(await AttendanceRecord.exists({ sessionId, studentId: students[2]._id })).toBeFalsy();
    expect((await scan(students[2], reopened.body.data.qr.token)).status).toBe(201);
  });
  test('reopening one course leaves another course session closed', async () => {
    const first = await open();
    const otherCourse = await f.createCourse();
    const otherBatch = await f.createBatch(otherCourse);
    const otherStudents = [await f.createUser('STUDENT')];
    await f.enroll(otherStudents[0], otherBatch);
    const second = await start(admin, otherBatch);
    await close(admin, first.sessionId);
    await close(admin, second.body.data.session._id);

    const reopened = await request(app)
      .post(`/api/v1/attendance-sessions/${first.sessionId}/reopen`)
      .set('Authorization', f.auth(admin));

    expect(reopened.status).toBe(200);
    expect((await AttendanceSession.findById(first.sessionId)).status).toBe('OPEN');
    expect((await AttendanceSession.findById(second.body.data.session._id)).status).toBe('CLOSED');
  });
  test('auto-close closes a session whose start day has ended even if its requested duration has not', async () => {
    const { sessionId } = await open();
    const yesterday = sessionDateFor(new Date(Date.now() - 2 * 86400000));
    await AttendanceSession.updateOne(
      { _id: sessionId },
      { $set: { sessionDate: yesterday, scheduledEnd: new Date(Date.now() + 86400000) } }
    );
    await sessionsService.autoCloseExpiredSessions();
    expect((await AttendanceSession.findById(sessionId)).status).toBe('CLOSED');
  });
  test('a session keeps its local start date across midnight and the next day permits a new scan', async () => {
    const sc = await scenario();
    const RealDate = global.Date;
    const clock = { now: new RealDate('2026-10-26T18:29:30.000Z') };
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock.now])); }
      static now() { return clock.now.getTime(); }
    };
    try {
      const first = await sessionsService.startSession(admin, String(sc.batch._id));
      expect(first.session.sessionDate.toISOString()).toBe('2026-10-26T00:00:00.000Z');
      expect(first.session.scheduledEnd.toISOString()).toBe('2026-10-26T18:29:59.999Z');

      clock.now = new RealDate('2026-10-26T18:30:01.000Z');
      await sessionsService.autoCloseExpiredSessions();
      expect((await AttendanceSession.findById(first.session._id)).status).toBe('CLOSED');

      const nextDay = await sessionsService.startSession(admin, String(sc.batch._id));
      expect(nextDay.session.sessionDate.toISOString()).toBe('2026-10-27T00:00:00.000Z');
      const result = await checkInService.checkIn(sc.students[0], { token: nextDay.qr.token });
      expect(result.status).toBe('PRESENT');
    } finally {
      global.Date = RealDate;
    }
  });
});

describe('reports and secret hygiene', () => {
  test('course pagination preserves legacy listing and enforces trainer scope', async () => {
    const assignedCourse = await f.createCourse();
    const otherCourse = await f.createCourse();
    const assignedBatch = await f.createBatch(assignedCourse, { isCourseGroup: true });
    await f.createBatch(otherCourse, { isCourseGroup: true });
    await f.assignTrainer(trainer, assignedBatch);
    const url = (courseId, page = 1) => `/api/v1/courses/paged?courseId=${courseId}&page=${page}&limit=1`;

    const adminResult = await request(app).get(url(assignedCourse._id)).set('Authorization', f.auth(admin));
    expect(adminResult.status).toBe(200);
    expect(adminResult.body.data).toMatchObject({ total: 1, page: 1, limit: 1, pages: 1 });
    expect(String(adminResult.body.data.items[0]._id)).toBe(String(assignedCourse._id));
    expect((await request(app).get(url(assignedCourse._id, 2)).set('Authorization', f.auth(admin))).body.data.items).toHaveLength(0);

    const trainerResult = await request(app).get(url(assignedCourse._id)).set('Authorization', f.auth(trainer));
    expect(trainerResult.body.data.total).toBe(1);
    expect((await request(app).get(url(otherCourse._id)).set('Authorization', f.auth(trainer))).body.data.total).toBe(0);
    expect(Array.isArray((await request(app).get('/api/v1/courses').set('Authorization', f.auth(admin))).body.data)).toBe(true);
  });

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
    const overview = await request(app).get(`/api/v1/attendance/reports/overview?batchId=${batch._id}`).set('Authorization', f.auth(admin));
    expect(overview.status).toBe(200);
    expect(overview.body.data.report.items).toEqual(rep.body.data.items);
    expect(overview.body.data.summary.totals).toMatchObject({ present: 1, absent: 2 });
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
