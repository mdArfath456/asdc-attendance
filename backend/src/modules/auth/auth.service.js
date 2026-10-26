const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const env = require('../../config/env');
const ApiError = require('../../utils/ApiError');
const User = require('../users/user.model');
const { ensureStudentId, nextStudentId } = require('../users/studentId.service');
const RefreshToken = require('./refreshToken.model');
const audit = require('../audit/audit.service');
const { verifyPassword, dummyHash } = require('./password');
const { verifyGoogleIdToken } = require('./google.verifier');
const Course = require('../courses/course.model');
const coursesService = require('../courses/courses.service');
const Enrollment = require('../enrollments/enrollment.model');
const { runInTransaction } = require('../../utils/transaction');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function accessTokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES,
    algorithm: 'HS256',
  });
}

function successorEncryptionKey() {
  return crypto.createHash('sha256').update(`${env.JWT_ACCESS_SECRET}:refresh-successor`).digest();
}

function encryptRefreshToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', successorEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

function decryptRefreshToken(value) {
  try {
    const packed = Buffer.from(value, 'base64url');
    const iv = packed.subarray(0, 12);
    const tag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', successorEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }
}

async function issueTokens(user, ctx = {}, familyId = crypto.randomUUID()) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  await RefreshToken.create({
    userId: user.id,
    tokenHash: sha256(refreshToken),
    familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000),
    userAgent: ctx.userAgent ? String(ctx.userAgent).slice(0, 200) : undefined,
    ip: ctx.ip,
  });
  return { accessToken: accessTokenFor(user), refreshToken };
}

async function loginLocal({ email, password, adminOnly = false }, ctx) {
  const normalizedEmail = String(email).trim().toLowerCase();
  if (adminOnly && normalizedEmail !== env.ADMIN_EMAIL) {
    throw new ApiError(403, 'NOT_ADMIN', 'You do not have access to the admin area');
  }
  if (normalizedEmail === env.ADMIN_EMAIL && !env.ADMIN_PASSWORD) {
    await verifyPassword(password, await dummyHash());
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');
  const hash = user && user.passwordHash ? user.passwordHash : await dummyHash();
  const valid = await verifyPassword(password, hash);
  if (!user || !user.passwordHash || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  if (adminOnly && (user.role !== 'ADMIN' || user.email !== env.ADMIN_EMAIL)) {
    throw new ApiError(403, 'NOT_ADMIN', 'You do not have access to the admin area');
  }
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_INACTIVE', 'Your account is not active');
  const signedInUser = user.role === 'STUDENT' ? await ensureStudentId(user) : user;
  const tokens = await issueTokens(signedInUser, ctx);
  return { user: signedInUser, ...tokens };
}

async function verifyGoogleClaims(idToken) {
  let claims;
  try {
    claims = await verifyGoogleIdToken(idToken);
  } catch (e) {
    throw new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Google credential could not be verified');
  }
  if (!claims || !claims.sub || !claims.email || claims.emailVerified !== true) {
    throw new ApiError(401, 'GOOGLE_EMAIL_UNVERIFIED', 'Google account email is not verified');
  }
  return { ...claims, email: String(claims.email).trim().toLowerCase() };
}

async function loginWithGoogle(idToken, ctx, { adminOnly = false } = {}) {
  const claims = await verifyGoogleClaims(idToken);
  if (adminOnly && claims.email !== env.ADMIN_EMAIL) {
    throw new ApiError(403, 'NOT_ADMIN', 'This account is not an admin');
  }
  const email = claims.email;
  let user = await User.findOne({ googleId: claims.sub });
  if (!user) {
    user = await User.findOne({ email });
    if (!user) {
      if (email === env.ADMIN_EMAIL) throw new ApiError(403, 'NOT_ADMIN', 'This account is not an admin');
      throw new ApiError(409, 'REGISTRATION_REQUIRED', 'Complete registration to continue', { name: claims.name || '' });
    }
    if (adminOnly && (user.role !== 'ADMIN' || user.email !== env.ADMIN_EMAIL)) {
      throw new ApiError(403, 'NOT_ADMIN', 'This account is not an admin');
    }
    if (user.googleId && user.googleId !== claims.sub) {
      await audit.log({ actorId: user.id, action: 'GOOGLE_LINK_REJECTED', entityType: 'User', entityId: user._id, reason: 'googleId mismatch' });
      throw new ApiError(403, 'GOOGLE_ACCOUNT_MISMATCH', 'This ASDC account is linked to a different Google account');
    }
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_INACTIVE', 'Your account is not active');
    user.googleId = claims.sub; // immutable Google `sub`
    if (!user.authProviders.includes('GOOGLE')) user.authProviders.push('GOOGLE');
    if (!user.avatarUrl && claims.picture) user.avatarUrl = claims.picture;
    await user.save();
    await audit.log({ actorId: user.id, action: 'GOOGLE_LINKED', entityType: 'User', entityId: user._id, metadata: { email } });
  }
  if (adminOnly && (user.role !== 'ADMIN' || user.email !== env.ADMIN_EMAIL)) {
    throw new ApiError(403, 'NOT_ADMIN', 'This account is not an admin');
  }
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_INACTIVE', 'Your account is not active');
  const signedInUser = user.role === 'STUDENT' ? await ensureStudentId(user) : user;
  const tokens = await issueTokens(signedInUser, ctx);
  return { user: signedInUser, ...tokens };
}

async function registerLocal(input, ctx) {
  const email = input.email.trim().toLowerCase();
  if (email === env.ADMIN_EMAIL) throw new ApiError(403, 'ADMIN_REGISTRATION_FORBIDDEN', 'This email is reserved for the administrator');
  if (await User.exists({ email })) throw new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'An account with this email already exists');
  const course = input.courseId ? await Course.findOne({ _id: input.courseId, status: 'ACTIVE' }) : null;
  if (input.courseId && !course) throw new ApiError(404, 'COURSE_NOT_AVAILABLE', 'Choose an active course');
  const requestedCourseName = input.requestedCourseName && input.requestedCourseName.trim();
  return runInTransaction(async (txn) => {
    const options = txn ? { session: txn } : {};
    const [user] = await User.create([{
      name: input.name,
      email,
      role: 'STUDENT',
      studentId: await nextStudentId(),
      authProviders: ['LOCAL'],
      passwordHash: await require('./password').hashPassword(input.password),
      ...(input.mobileNumber ? { mobileNumber: input.mobileNumber } : {}),
      ...(input.fatherName ? { fatherName: input.fatherName } : {}),
      ...(input.motherName ? { motherName: input.motherName } : {}),
      ...(requestedCourseName ? { requestedCourseName } : {}),
    }], options);
    if (course) {
      const batch = await coursesService.ensureCourseBatch(course);
      const [enrollment] = await Enrollment.create([{
        studentId: user._id, batchId: batch._id, courseId: course._id, createdBy: user._id,
      }], options);
      await audit.log({ actorId: user._id, action: 'STUDENT_REGISTERED', entityType: 'Enrollment', entityId: enrollment._id, metadata: { courseId: String(course._id) } }, txn);
    } else {
      await audit.log({ actorId: user._id, action: 'STUDENT_REGISTERED', entityType: 'User', entityId: user._id, metadata: { requestedCourseName } }, txn);
    }
    const tokens = await issueTokens(user, ctx);
    return { user, ...tokens };
  });
}

async function registerGoogle({ idToken, courseId, requestedCourseName, mobileNumber, fatherName, motherName }, ctx) {
  const claims = await verifyGoogleClaims(idToken);
  if (claims.email === env.ADMIN_EMAIL) throw new ApiError(403, 'ADMIN_REGISTRATION_FORBIDDEN', 'This email is reserved for the administrator');
  if (await User.exists({ $or: [{ email: claims.email }, { googleId: claims.sub }] })) {
    throw new ApiError(409, 'ACCOUNT_ALREADY_REGISTERED', 'This Google account is already registered. Sign in instead.');
  }
  const course = courseId ? await Course.findOne({ _id: courseId, status: 'ACTIVE' }) : null;
  if (courseId && !course) throw new ApiError(404, 'COURSE_NOT_AVAILABLE', 'Choose an active course');
  const cleanRequestedCourseName = requestedCourseName && requestedCourseName.trim();
  return runInTransaction(async (txn) => {
    const options = txn ? { session: txn } : {};
    const [user] = await User.create([{
      name: String(claims.name || claims.email.split('@')[0]).trim().slice(0, 120) || claims.email.split('@')[0],
      email: claims.email,
      role: 'STUDENT',
      studentId: await nextStudentId(),
      googleId: claims.sub,
      authProviders: ['GOOGLE'],
      avatarUrl: claims.picture,
      ...(mobileNumber ? { mobileNumber } : {}),
      ...(fatherName ? { fatherName } : {}),
      ...(motherName ? { motherName } : {}),
      ...(cleanRequestedCourseName ? { requestedCourseName: cleanRequestedCourseName } : {}),
    }], options);
    if (course) {
      const batch = await coursesService.ensureCourseBatch(course);
      const [enrollment] = await Enrollment.create([{
        studentId: user._id, batchId: batch._id, courseId: course._id, createdBy: user._id,
      }], options);
      await audit.log({ actorId: user._id, action: 'STUDENT_REGISTERED', entityType: 'Enrollment', entityId: enrollment._id, metadata: { courseId: String(course._id), provider: 'GOOGLE' } }, txn);
    } else {
      await audit.log({ actorId: user._id, action: 'STUDENT_REGISTERED', entityType: 'User', entityId: user._id, metadata: { requestedCourseName: cleanRequestedCourseName, provider: 'GOOGLE' } }, txn);
    }
    const tokens = await issueTokens(user, ctx);
    return { user, ...tokens };
  });
}

async function replayRotatedToken(doc, ctx) {
  if (!doc.rotatedAt) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }
  const elapsed = Date.now() - new Date(doc.rotatedAt || doc.revokedAt).getTime();
  if (elapsed > 10000) {
    await RefreshToken.updateMany({ familyId: doc.familyId, revokedAt: null }, { revokedAt: new Date() });
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token reuse detected; please log in again');
  }
  if (!doc.successorTokenEncrypted) {
    throw new ApiError(409, 'REFRESH_RACE', 'Refresh token rotation is still in progress');
  }
  const refreshToken = decryptRefreshToken(doc.successorTokenEncrypted);
  const successor = await RefreshToken.findOne({ tokenHash: sha256(refreshToken), familyId: doc.familyId });
  if (!successor || successor.revokedAt || successor.expiresAt <= new Date()) {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }
  const user = await User.findById(successor.userId);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'UNAUTHENTICATED', 'Account is not active');
  return { user, accessToken: accessTokenFor(user), refreshToken };
}

// A rotated token can be replayed for ten seconds to make parallel tabs and requests idempotent.
async function refresh(rawToken, ctx) {
  if (!rawToken) throw new ApiError(401, 'NO_REFRESH_TOKEN', 'Refresh token missing');
  const doc = await RefreshToken.findOne({ tokenHash: sha256(rawToken) }).select('+successorTokenEncrypted');
  if (!doc) throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  if (doc.revokedAt) return replayRotatedToken(doc, ctx);
  if (doc.expiresAt <= new Date()) throw new ApiError(401, 'REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  const user = await User.findById(doc.userId);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'UNAUTHENTICATED', 'Account is not active');
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const rotatedAt = new Date();
  const successor = await RefreshToken.create({
    userId: user._id,
    tokenHash: sha256(refreshToken),
    familyId: doc.familyId,
    expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86400000),
    userAgent: ctx.userAgent ? String(ctx.userAgent).slice(0, 200) : undefined,
    ip: ctx.ip,
  });
  const updated = await RefreshToken.updateOne(
    { _id: doc._id, revokedAt: null },
    { $set: { revokedAt: rotatedAt, rotatedAt, successorTokenEncrypted: encryptRefreshToken(refreshToken) } }
  );
  if (updated.modifiedCount !== 1) {
    await RefreshToken.deleteOne({ _id: successor._id });
    const latest = await RefreshToken.findById(doc._id).select('+successorTokenEncrypted');
    if (latest && latest.revokedAt) return replayRotatedToken(latest, ctx);
    throw new ApiError(409, 'REFRESH_RACE', 'Refresh token rotation is still in progress');
  }
  return { user, accessToken: accessTokenFor(user), refreshToken };
}

async function logout(rawToken) {
  if (!rawToken) return;
  await RefreshToken.updateOne({ tokenHash: sha256(rawToken), revokedAt: null }, { revokedAt: new Date() });
}

const revokeAllForUser = (userId) => RefreshToken.updateMany({ userId, revokedAt: null }, { revokedAt: new Date() });

module.exports = { loginLocal, loginWithGoogle, registerLocal, registerGoogle, refresh, logout, revokeAllForUser, issueTokens };
