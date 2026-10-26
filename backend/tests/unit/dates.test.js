const { sessionDateFor, sessionDayEndFor } = require('../../src/utils/dates');

describe('configured timezone session day', () => {
  test('sessionDateFor uses the configured local calendar day', () => {
    expect(sessionDateFor(new Date('2026-10-26T19:00:00.000Z')).toISOString())
      .toBe('2026-10-27T00:00:00.000Z');
  });

  test('sessionDayEndFor returns the final millisecond of the local day', () => {
    expect(sessionDayEndFor(new Date('2026-10-26T18:00:00.000Z')).toISOString())
      .toBe('2026-10-26T18:29:59.999Z');
  });
});
