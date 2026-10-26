const mongoose = require('mongoose');
const Enrollment = require('../enrollments/enrollment.model');
const AttendanceRecord = require('./attendanceRecord.model');
const AttendanceSession = require('./attendanceSession.model');
const { computePercentage } = require('../../utils/percentage');
const env = require('../../config/env');

// A student's own history, grouped by enrollment (so transfers keep their old batch history).
async function myHistory(user, { page = 1, limit = 50 } = {}) {
  const [enrollments, aggregation] = await Promise.all([
    Enrollment.find({ studentId: user.id })
      .select('status enrolledAt endedAt batchId courseId')
      .populate('batchId', 'name')
      .populate('courseId', 'name code')
      .sort({ enrolledAt: 1 })
      .lean(),
    AttendanceRecord.aggregate([
      { $match: { studentId: new mongoose.Types.ObjectId(user.id) } },
      { $sort: { sessionDate: 1 } },
      { $lookup: { from: AttendanceSession.collection.name, localField: 'sessionId', foreignField: '_id', as: 'session' } },
      { $unwind: '$session' },
      { $match: { 'session.status': 'CLOSED' } },
      {
        $facet: {
          totals: [{
            $group: {
              _id: '$enrollmentId',
              present: { $sum: { $cond: [{ $eq: ['$status', 'PRESENT'] }, 1, 0] } },
              late: { $sum: { $cond: [{ $eq: ['$status', 'LATE'] }, 1, 0] } },
              absent: { $sum: { $cond: [{ $eq: ['$status', 'ABSENT'] }, 1, 0] } },
              excused: { $sum: { $cond: [{ $eq: ['$status', 'EXCUSED'] }, 1, 0] } },
            },
          }],
          sessions: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $project: {
                _id: 0,
                recordId: '$_id',
                enrollmentId: 1,
                sessionId: '$session._id',
                sessionDate: '$session.sessionDate',
                title: '$session.title',
                status: 1,
                checkInTimestamp: 1,
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]),
  ]);
  const { totals: enrollmentTotals = [], sessions = [], total = [] } = aggregation[0] || {};
  const totalsByEnrollment = new Map(enrollmentTotals.map((row) => [String(row._id), row]));
  const sessionsByEnrollment = new Map();
  for (const session of sessions) {
    const key = String(session.enrollmentId);
    if (!sessionsByEnrollment.has(key)) sessionsByEnrollment.set(key, []);
    sessionsByEnrollment.get(key).push({
      recordId: String(session.recordId),
      sessionId: String(session.sessionId),
      sessionDate: session.sessionDate,
      title: session.title,
      status: session.status,
      checkInTimestamp: session.checkInTimestamp,
    });
  }
  const groups = enrollments.map((e) => {
    const counts = totalsByEnrollment.get(String(e._id)) || { present: 0, late: 0, absent: 0, excused: 0 };
    const calc = computePercentage(counts);
    return {
      enrollmentId: String(e._id), status: e.status, enrolledAt: e.enrolledAt, endedAt: e.endedAt,
      batch: e.batchId && { id: String(e.batchId._id), name: e.batchId.name },
      course: e.courseId && { id: String(e.courseId._id), name: e.courseId.name, code: e.courseId.code },
      summary: { ...counts, percentage: calc.percentage, belowThreshold: calc.percentage !== null && calc.percentage < env.ATTENDANCE_THRESHOLD },
      sessions: sessionsByEnrollment.get(String(e._id)) || [],
    };
  });
  const totals = groups.reduce((a, g) => ({ present: a.present + g.summary.present, late: a.late + g.summary.late, absent: a.absent + g.summary.absent, excused: a.excused + g.summary.excused }), { present: 0, late: 0, absent: 0, excused: 0 });
  const recordCount = total[0]?.count || 0;
  return {
    overall: { ...totals, percentage: computePercentage(totals).percentage, threshold: env.ATTENDANCE_THRESHOLD },
    enrollments: groups,
    history: { page, limit, total: recordCount, pages: Math.ceil(recordCount / limit) },
  };
}
module.exports = { myHistory };
