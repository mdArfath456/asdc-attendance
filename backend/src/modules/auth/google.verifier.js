const { OAuth2Client } = require('google-auth-library');
const env = require('../../config/env');

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Cryptographically verifies a Google ID token (signature, exp, aud) and re-checks iss.
// Never decode client-side payloads; only the claims returned here are trusted.
async function verifyGoogleIdToken(idToken) {
  const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p || !ISSUERS.includes(p.iss) || p.aud !== env.GOOGLE_CLIENT_ID) throw new Error('Unexpected token claims');
  return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name, picture: p.picture };
}

module.exports = { verifyGoogleIdToken };
