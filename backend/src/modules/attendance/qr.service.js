const crypto = require('crypto');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');

// Token format: ASDC1.<sessionId>.<version>.<HMAC-SHA256 base64url>
// Stateless signed token + versioned metadata on the session (one session read per scan,
// no per-token DB writes). Contains no personal data. Revocation = close/cancel session
// (status check) or bump the version.
const PREFIX = 'ASDC1';
const invalid = () => new ApiError(400, 'QR_INVALID', 'Invalid QR code');
const expired = () => new ApiError(400, 'QR_EXPIRED', 'This QR code has expired. Scan the code currently on screen.');

const mac = (sessionId, version) =>
  crypto.createHmac('sha256', env.QR_SIGNING_SECRET).update(`${PREFIX}.${sessionId}.${version}`).digest('base64url');

const signToken = (sessionId, version) => `${PREFIX}.${sessionId}.${version}.${mac(String(sessionId), String(version))}`;

function parseToken(token) {
  if (typeof token !== 'string') throw invalid();
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw invalid();
  const [, sessionId, versionStr, sig] = parts;
  if (!/^[a-f\d]{24}$/i.test(sessionId) || !/^\d{1,9}$/.test(versionStr)) throw invalid();
  const expected = Buffer.from(mac(sessionId, versionStr));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) throw invalid();
  return { sessionId, version: Number(versionStr) };
}

// Version N valid for R+G seconds after its rotation (absolute cap if the presenter stops rotating);
// version N-1 valid only for G seconds after rotation to N (network-latency grace window).
function validateAgainstSession(session, parsed, now = new Date()) {
  if (parsed.sessionId !== String(session._id)) throw invalid();
  const age = now.getTime() - new Date(session.lastRotatedAt).getTime();
  const R = session.refreshIntervalSeconds * 1000;
  const G = session.gracePeriodSeconds * 1000;
  const current = session.currentTokenVersion;
  if (parsed.version === current) {
    if (age <= R + G) return;
    throw expired();
  }
  if (parsed.version === current - 1) {
    if (age <= G) return;
    throw expired();
  }
  if (parsed.version > current) throw invalid();
  throw expired();
}

function describe(session, now = new Date()) {
  return {
    token: signToken(session._id, session.currentTokenVersion),
    version: session.currentTokenVersion,
    refreshIntervalSeconds: session.refreshIntervalSeconds,
    gracePeriodSeconds: session.gracePeriodSeconds,
    expiresInSeconds: session.refreshIntervalSeconds + session.gracePeriodSeconds,
    serverTime: now.toISOString(),
  };
}

module.exports = { signToken, parseToken, validateAgainstSession, describe };
