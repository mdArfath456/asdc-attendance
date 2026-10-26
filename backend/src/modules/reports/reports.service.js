const mongoose = require('mongoose');
const env = require('../../config/env');
const AttendanceRecord = require('../attendance/attendanceRecord.model');
const AttendanceSession = require('../attendance/attendanceSession.model');
const Enrollment = require('../enrollments/enrollment.model');
const Batch = require('../batches/batch.model');
const TrainerAssignment = require('../batches/trainerAssignment.model');
const User = require('../users/user.model');
const { assertBatchAccess } = require('../batches/batches.service');
const { computePercentage } = require('../../utils/percentage');

const oid = (v) => new mongoose.Types.ObjectId(String(v));

async function scopeBatchIds(user, { batchId, courseId }) {
  let ids = null; // null = unrestricted (admins)
  if (batchId) {
    await assertBatchAccess(user, batchId);
    ids = [String(batchId)];
  } else if (user.role === 'TRAINER') {
    ids = (await TrainerAssignment.find({ trainerId: user.id }).distinct('batchId')).map(String);
  }
  if (courseId) {
    const inCourse = (await Batch.find({ courseId }).distinct('_id')).map(String);
    ids = ids ? ids.filter((i) => inCourse.includes(i)) : inCourse;
  }
  return ids;
}

// One row per enrollment, over CLOSED sessions only (CANCELLED never counted).
async function buildRows(user, q, scopedIds) {
  const ids = scopedIds === undefined ? await scopeBatchIds(user, q) : scopedIds;
  if (ids && ids.length === 0) return [];
  const match = {};
  if (ids) match.batchId = { $in: ids.map(oid) };
  if (q.studentId) match.studentId = oid(q.studentId);
  const sessionMatch = { 'session.status': 'CLOSED' };
  if (q.from || q.to) sessionMatch['session.sessionDate'] = { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) };
  const cond = (s) => ({ $sum: { $cond: [{ $eq: ['$status', s] }, 1, 0] } });

  const grouped = await AttendanceRecord.aggregate([
    { $match: match },
    { $lookup: { from: AttendanceSession.collection.name, localField: 'sessionId', foreignField: '_id', as: 'session' } },
    { $unwind: '$session' },
    { $match: sessionMatch },
    { $group: { _id: '$enrollmentId', studentId: { $first: '$studentId' }, batchId: { $first: '$batchId' }, present: cond('PRESENT'), late: cond('LATE'), absent: cond('ABSENT'), excused: cond('EXCUSED') } },
  ]);
  if (!grouped.length) return [];

  const [enrollments, users, batches] = await Promise.all([
    Enrollment.find({ _id: { $in: grouped.map((g) => g._id) } }).select('status').lean(),
    User.find({ _id: { $in: grouped.map((g) => g.studentId) } }).select('name email').lean(),
    Batch.find({ _id: { $in: grouped.map((g) => g.batchId) } }).populate('courseId', 'name code').lean(),
  ]);
  const eMap = new Map(enrollments.map((e) => [String(e._id), e]));
  const uMap = new Map(users.map((u) => [String(u._id), u]));
  const bMap = new Map(batches.map((b) => [String(b._id), b]));

  return grouped.map((g) => {
    const calc = computePercentage(g);
    const u = uMap.get(String(g.studentId)) || {};
    const b = bMap.get(String(g.batchId)) || {};
    return {
      enrollmentId: String(g._id), studentId: String(g.studentId), studentName: u.name, studentEmail: u.email,
      batchId: String(g.batchId), batchName: b.name, courseName: b.courseId && b.courseId.name, courseCode: b.courseId && b.courseId.code,
      enrollmentStatus: (eMap.get(String(g._id)) || {}).status,
      present: calc.present, late: calc.late, absent: calc.absent, excused: calc.excused, percentage: calc.percentage,
      belowThreshold: calc.percentage !== null && calc.percentage < env.ATTENDANCE_THRESHOLD,
    };
  }).sort((a, b) => String(a.studentName).localeCompare(String(b.studentName)));
}

async function report(user, q) {
  const rows = await buildRows(user, q);
  const start = (q.page - 1) * q.limit;
  return { items: rows.slice(start, start + q.limit), total: rows.length, page: q.page, limit: q.limit };
}

// Prevent spreadsheet formula injection in exported cells.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const COLS = ['studentName', 'studentEmail', 'courseName', 'batchName', 'enrollmentStatus', 'present', 'late', 'absent', 'excused', 'percentage'];

async function exportReport(user, q) {
  const rows = await buildRows(user, q);
  if (q.format === 'json') return { contentType: 'application/json', filename: 'attendance-report.json', body: JSON.stringify(rows, null, 2) };
  const csv = [COLS.join(','), ...rows.map((r) => COLS.map((c) => csvCell(r[c])).join(','))].join('\n');
  return { contentType: 'text/csv; charset=utf-8', filename: 'attendance-report.csv', body: csv };
}

async function summaryFromRows(user, q, rows, ids) {
  const totals = rows.reduce((a, r) => ({ present: a.present + r.present, late: a.late + r.late, absent: a.absent + r.absent, excused: a.excused + r.excused }), { present: 0, late: 0, absent: 0, excused: 0 });
  const byBatch = new Map();
  for (const r of rows) {
    const b = byBatch.get(r.batchId) || { batchId: r.batchId, batchName: r.batchName, courseName: r.courseName, present: 0, late: 0, absent: 0, excused: 0, students: 0, belowThreshold: 0 };
    b.present += r.present; b.late += r.late; b.absent += r.absent; b.excused += r.excused; b.students += 1; if (r.belowThreshold) b.belowThreshold += 1;
    byBatch.set(r.batchId, b);
  }
  const sessionFilter = ids ? { batchId: { $in: ids.map(oid) } } : {};
  const [closed, cancelled] = await Promise.all([
    AttendanceSession.countDocuments({ ...sessionFilter, status: 'CLOSED' }),
    AttendanceSession.countDocuments({ ...sessionFilter, status: 'CANCELLED' }),
  ]);
  return {
    totals: { ...totals, percentage: computePercentage(totals).percentage },
    sessions: { closed, cancelled },
    studentsBelowThreshold: rows.filter((r) => r.belowThreshold).length,
    threshold: env.ATTENDANCE_THRESHOLD,
    batches: [...byBatch.values()].map((b) => ({ ...b, percentage: computePercentage(b).percentage })),
  };
}

async function summary(user, q) {
  const ids = await scopeBatchIds(user, q);
  const rows = await buildRows(user, q, ids);
  return summaryFromRows(user, q, rows, ids);
}

async function overview(user, q) {
  const ids = await scopeBatchIds(user, q);
  const rows = await buildRows(user, q, ids);
  const start = (q.page - 1) * q.limit;
  const reportData = { items: rows.slice(start, start + q.limit), total: rows.length, page: q.page, limit: q.limit };
  const summaryData = await summaryFromRows(user, q, rows, ids);
  return { report: reportData, summary: summaryData };
}

module.exports = { report, exportReport, summary, overview };
