const qr = require('../../src/modules/attendance/qr.service');

const SID = 'a'.repeat(24);
const session = (over = {}) => ({ _id: SID, currentTokenVersion: 5, lastRotatedAt: new Date(), refreshIntervalSeconds: 20, gracePeriodSeconds: 10, ...over });
const t = (v) => qr.parseToken(qr.signToken(SID, v));
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

describe('QR token', () => {
  test('sign/parse round trip; payload has no personal data', () => {
    const token = qr.signToken(SID, 3);
    expect(qr.parseToken(token)).toEqual({ sessionId: SID, version: 3 });
    expect(token.startsWith('ASDC1.')).toBe(true);
  });
  test('tampered signature or version is QR_INVALID', () => {
    const token = qr.signToken(SID, 3);
    expect(code(() => qr.parseToken(token.slice(0, -2) + 'xx'))).toBe('QR_INVALID');
    expect(code(() => qr.parseToken(token.replace('.3.', '.4.')))).toBe('QR_INVALID');
    expect(code(() => qr.parseToken('garbage'))).toBe('QR_INVALID');
  });
  test('current version valid within R+G, expired after', () => {
    const now = new Date();
    expect(code(() => qr.validateAgainstSession(session({ lastRotatedAt: new Date(now - 29000) }), t(5), now))).toBeNull();
    expect(code(() => qr.validateAgainstSession(session({ lastRotatedAt: new Date(now - 31000) }), t(5), now))).toBe('QR_EXPIRED');
  });
  test('previous version valid only inside grace window (G=10s)', () => {
    const now = new Date();
    expect(code(() => qr.validateAgainstSession(session({ lastRotatedAt: new Date(now - 9000) }), t(4), now))).toBeNull();
    expect(code(() => qr.validateAgainstSession(session({ lastRotatedAt: new Date(now - 11000) }), t(4), now))).toBe('QR_EXPIRED');
  });
  test('older versions expired; future versions invalid; other session invalid', () => {
    const now = new Date();
    expect(code(() => qr.validateAgainstSession(session(), t(3), now))).toBe('QR_EXPIRED');
    expect(code(() => qr.validateAgainstSession(session(), t(6), now))).toBe('QR_INVALID');
    expect(code(() => qr.validateAgainstSession(session({ _id: 'b'.repeat(24) }), t(5), now))).toBe('QR_INVALID');
  });
});
