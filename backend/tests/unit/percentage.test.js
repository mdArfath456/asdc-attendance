const { computePercentage } = require('../../src/utils/percentage');

describe('attendance percentage formula', () => {
  const counts = { present: 12, late: 3, absent: 2, excused: 1 };
  test('documented example (EXCUSED excluded, LATE weight 0.5) = 79.41', () => {
    const r = computePercentage(counts, { lateWeight: 0.5, excusedPolicy: 'EXCLUDE' });
    expect(r.denominator).toBe(17);
    expect(r.numerator).toBe(13.5);
    expect(r.percentage).toBe(79.41);
  });
  test('EXCUSED as full credit = 80.56', () => {
    expect(computePercentage(counts, { lateWeight: 0.5, excusedPolicy: 'FULL_CREDIT' }).percentage).toBe(80.56);
  });
  test('no eligible sessions -> null, not 0', () => {
    expect(computePercentage({ excused: 2 }, { excusedPolicy: 'EXCLUDE' }).percentage).toBeNull();
  });
});
