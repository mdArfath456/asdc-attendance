const Enrollment = require('../enrollments/enrollment.model');
const AttendanceRecord = require('./attendanceRecord.model');
const { computePercentage } = require('../../utils/percentage');
const env = require('../../config/env');

// A student's own history, grouped by enrollment (so transfers keep their old batch history).
async function myHistory(user) {
  const enrollments = await Enrollment.find({ studentId: user.id }).populate('batchId', 'name').populate('courseId', 'name code').sort({ enrolledAt: 1 }).lean();
  const records = await AttendanceRecord.find({ studentId: user.id }).populate('sessionId', 'sessionDate status title actualStartTime').lean();
  const byEnrollment = new Map();
  for (const r of records) {
    if (!r.sessionId || r.sessionId.status !== 'CLOSED') continue; // CANCELLED/open sessions excluded
    const k = String(r.enrollmentId);
    if (!byEnrollment.has(k)) byEnrollment.set(k, []);
    byEnrollment.get(k).push(r);
  }
  const groups = enrollments.map((e) => {
    const recs = (byEnrollment.get(String(e._id)) || []).sort((a, b) => new Date(a.sessionId.sessionDate) - new Date(b.sessionId.sessionDate));
    const counts = { present: 0, late: 0, absent: 0, excused: 0 };
    recs.forEach((r) => { counts[r.status.toLowerCase()] += 1; });
    const calc = computePercentage(counts);
    return {
      enrollmentId: String(e._id), status: e.status, enrolledAt: e.enrolledAt, endedAt: e.endedAt,
      batch: e.batchId && { id: String(e.batchId._id), name: e.batchId.name },
      course: e.courseId && { id: String(e.courseId._id), name: e.courseId.name, code: e.courseId.code },
      summary: { ...counts, percentage: calc.percentage, belowThreshold: calc.percentage !== null && calc.percentage < env.ATTENDANCE_THRESHOLD },
      sessions: recs.map((r) => ({ recordId: String(r._id), sessionId: String(r.sessionId._id), sessionDate: r.sessionId.sessionDate, title: r.sessionId.title, status: r.status, checkInTimestamp: r.checkInTimestamp })),
    };
  });
  const totals = groups.reduce((a, g) => ({ present: a.present + g.summary.present, late: a.late + g.summary.late, absent: a.absent + g.summary.absent, excused: a.excused + g.summary.excused }), { present: 0, late: 0, absent: 0, excused: 0 });
  return { overall: { ...totals, percentage: computePercentage(totals).percentage, threshold: env.ATTENDANCE_THRESHOLD }, enrollments: groups };
}
module.exports = { myHistory };
