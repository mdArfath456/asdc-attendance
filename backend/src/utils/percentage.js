const env = require('../config/env');

// Attendance percentage per enrollment. See docs/ATTENDANCE_FORMULA.md.
//   D = P + L + A  (+ X if EXCUSED_POLICY=FULL_CREDIT)
//   N = P + wL*L   (+ X if EXCUSED_POLICY=FULL_CREDIT)
//   % = N / D * 100, null when D = 0. CANCELLED sessions are never passed in.
function computePercentage(counts, opts = {}) {
  const lateWeight = opts.lateWeight ?? env.LATE_WEIGHT;
  const excusedPolicy = opts.excusedPolicy ?? env.EXCUSED_POLICY;
  const present = counts.present || 0;
  const late = counts.late || 0;
  const absent = counts.absent || 0;
  const excused = counts.excused || 0;
  let denominator = present + late + absent;
  let numerator = present + lateWeight * late;
  if (excusedPolicy === 'FULL_CREDIT') {
    denominator += excused;
    numerator += excused;
  }
  const percentage = denominator === 0 ? null : Math.round((numerator / denominator) * 10000) / 100;
  return { present, late, absent, excused, numerator, denominator, percentage };
}

module.exports = { computePercentage };
