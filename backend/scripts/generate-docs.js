// Generates docs/openapi.yaml and docs/ASDC.postman_collection.json from a single endpoint table.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const A = ['ADMIN'];
const S = ['ADMIN', 'TRAINER'];
const id = '{{id}}';
// [method, path, tag, summary, roles(null=public), body, query[], successStatus, extraErrors]
const E = [
  ['post', '/auth/register', 'Auth', 'Register a new student account with a chosen course', null, { name: 'Jane Student', email: 'student@example.com', password: 'StrongPassword9!', courseId: id }, [], 201, [403, 409, 429]],
  ['post', '/auth/register-google', 'Auth', 'Complete Google registration for a new student', null, { idToken: '<google credential>', courseId: id }, [], 201, [403, 409, 429]],
  ['post', '/auth/login', 'Auth', 'Email + password login; sets httpOnly refresh cookie', null, { email: 'student@example.com', password: 'StrongPassword9!' }, [], 200, [403, 429]],
  ['post', '/auth/google', 'Auth', 'Google sign-in for existing students or admins; unknown users start registration', null, { idToken: '<google credential>', adminOnly: false }, [], 200, [403, 409, 429]],
  ['post', '/auth/refresh', 'Auth', 'Rotate refresh token (cookie) and return a new access token', null, null, [], 200, [429]],
  ['post', '/auth/logout', 'Auth', 'Revoke the current refresh token', null, null, [], 200, []],
  ['get', '/auth/me', 'Auth', 'Current user', ['ADMIN', 'TRAINER', 'STUDENT'], null, [], 200, []],
  ['get', '/auth/admin-email', 'Auth', 'Read the configured admin email', null, null, [], 200, []],
  ['get', '/courses/public', 'Courses', 'Public course catalogue', null, null, [], 200, []],
  ['get', '/courses/public/:slug', 'Courses', 'Public course detail', null, null, [], 200, []],
  ['get', '/courses', 'Courses', 'Course list with trainer filtering', S, null, [], 200, []],
  ['post', '/courses', 'Courses', 'Create or edit course metadata', A, { name: 'Web Development', code: 'WEB', description: 'Frontend and backend fundamentals', isPublic: true }, [], 201, [409]],
  ['patch', '/courses/:courseId', 'Courses', 'Update a course', A, { description: 'Updated', isPublic: true }, [], 200, []],
  ['get', '/courses/:courseId/students', 'Courses', 'Students grouped by course (admin view)', A, null, [], 200, []],
  ['post', '/courses/:courseId/trainers', 'Courses', 'Assign a trainer to a course by email', A, { email: 'trainer@example.com' }, [], 201, [409]],
  ['delete', '/courses/:courseId/trainers/:trainerId', 'Courses', 'Remove a trainer from a course', A, null, [], 200, []],
  ['post', '/enrollments/join', 'Enrollments', 'Join a course as a student', ['STUDENT', 'ADMIN'], { courseId: id }, [], 201, [409]],
  ['post', '/batches/:batchId/enrollments', 'Enrollments', 'Enroll students in a batch', A, { studentIds: [id] }, [], 201, []],
  ['patch', '/enrollments/:enrollmentId/status', 'Enrollments', 'Mark an enrollment dropped or completed', A, { status: 'DROPPED', reason: 'Withdrew' }, [], 200, []],
  ['post', '/enrollments/:enrollmentId/transfer', 'Enrollments', 'Transfer a student to another course', A, { targetCourseId: id, reason: 'Schedule change' }, [], 200, []],
  ['post', '/attendance/check-in', 'Attendance', 'Check in with an active enrollment', ['STUDENT', 'ADMIN'], { token: 'ASDC1.<sessionId>.<version>.<signature>' }, [], 201, [409, 429]],
  ['get', '/attendance/my-history', 'Reports', 'View the authenticated student history', ['STUDENT', 'ADMIN'], null, [], 200, []],
  ['post', '/attendance-sessions/:sessionId/qr-token', 'Attendance sessions', 'Rotate or fetch the QR token for an active session', S, null, [], 200, [429]],
  ['post', '/attendance-sessions/:sessionId/close', 'Attendance sessions', 'Close a session', S, null, [], 200, []],
  ['get', '/attendance-sessions/:sessionId/records', 'Attendance sessions', 'Session attendance records', S, null, [], 200, []],
  ['get', '/attendance/summary', 'Reports', 'Summary of attendance for a course or batch', S, null, ['courseId', 'batchId', 'from', 'to'], 200, []],
  ['get', '/audit-logs', 'Audit', 'Audit trail', A, null, ['action', 'actorId', 'entityType', 'entityId', 'from', 'to', 'page', 'limit'], 200, []],
];

const errDesc = { 400: 'Validation error', 401: 'Unauthenticated / expired token', 403: 'Forbidden (role or batch scope)', 404: 'Not found', 409: 'Conflict (duplicate, state, already checked in)', 429: 'Rate limited' };
const toOA = (p) => p.replace(/:(\w+)/g, '{$1}');
const envelope = { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: {} } };

const paths = {};
for (const [method, p, tag, summary, roles, body, query, ok, extra] of E) {
  const params = [...(p.match(/:(\w+)/g) || []).map((x) => ({ name: x.slice(1), in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{24}$' } })), ...query.map((q) => ({ name: q, in: 'query', required: false, schema: { type: 'string' } }))];
  const responses = { [ok]: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } };
  const errs = new Set([400, ...(roles ? [401, 403] : []), ...(p.match(/:/) ? [404] : []), ...extra]);
  errs.forEach((c) => { responses[c] = { $ref: '#/components/responses/Error' + c }; });
  paths[toOA(p)] = paths[toOA(p)] || {};
  paths[toOA(p)][method] = {
    tags: [tag], summary, description: roles ? `Roles: ${roles.join(', ')}` : 'Public',
    ...(roles ? { security: [{ bearerAuth: [] }] } : { security: [] }),
    ...(params.length ? { parameters: params } : {}),
    ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' }, example: body } } } } : {}),
    responses,
  };
}
const responses = {};
Object.entries(errDesc).forEach(([c, d]) => {
  responses['Error' + c] = { description: d, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: d, error: { code: 'ERROR_CODE', details: null } } } } };
});
const spec = {
  openapi: '3.0.3',
  info: { title: 'ASDC Attendance Management API', version: '1.0.0', description: 'QR attendance with Google OAuth. Error codes: QR_INVALID, QR_EXPIRED, SESSION_CLOSED, SESSION_NOT_OPEN, BATCH_MISMATCH, ENROLLMENT_INELIGIBLE, ALREADY_CHECKED_IN, ACCOUNT_NOT_REGISTERED, VALIDATION_ERROR ...' },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: { Envelope: envelope, Error: { type: 'object', properties: { success: { type: 'boolean', example: false }, message: { type: 'string' }, error: { type: 'object', properties: { code: { type: 'string' }, details: {} } } } } },
    responses,
  },
  paths,
};
fs.writeFileSync(path.join(__dirname, '../docs/openapi.yaml'), yaml.dump(spec, { noRefs: true, lineWidth: 120 }));

const folders = {};
for (const [method, p, tag, summary, roles, body, query] of E) {
  (folders[tag] = folders[tag] || []).push({
    name: `${method.toUpperCase()} ${p}`,
    request: {
      method: method.toUpperCase(),
      header: [{ key: 'Content-Type', value: 'application/json' }],
      ...(roles ? { auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] } } : { auth: { type: 'noauth' } }),
      url: { raw: `{{baseUrl}}${p.replace(/:(\w+)/g, '{{$1}}')}`, host: ['{{baseUrl}}'], path: p.replace(/:(\w+)/g, '{{$1}}').split('/').filter(Boolean), query: query.map((q) => ({ key: q, value: '', disabled: true })) },
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } } : {}),
      description: `${summary}\nRoles: ${roles ? roles.join(', ') : 'public'}`,
    },
    ...(p === '/auth/login' || p === '/auth/google' || p === '/auth/refresh'
      ? { event: [{ listen: 'test', script: { type: 'text/javascript', exec: ['const j = pm.response.json(); if (j.data && j.data.accessToken) pm.collectionVariables.set("accessToken", j.data.accessToken);'] } }] }
      : {}),
  });
}
const collection = {
  info: { name: 'ASDC Attendance API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'baseUrl', value: 'http://localhost:5000/api/v1' }, { key: 'accessToken', value: '' }, ...['userId', 'courseId', 'batchId', 'trainerId', 'enrollmentId', 'sessionId', 'recordId', 'slug', 'id'].map((k) => ({ key: k, value: '' }))],
  item: Object.entries(folders).map(([name, item]) => ({ name, item })),
};
fs.writeFileSync(path.join(__dirname, '../docs/ASDC.postman_collection.json'), JSON.stringify(collection, null, 2));
console.log(`Generated ${E.length} endpoints`);
