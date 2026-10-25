const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./enrollments.controller');
const v = require('./enrollments.validation');

// Mounted at the API root, so guards are attached per route (never router.use).
const admins = [authenticate, authorizeRoles('ADMIN')];
router.post('/enrollments/join', authenticate, authorizeRoles('STUDENT'), validate({ body: v.join }), ctrl.join);
router.post('/enrollments/request-course', authenticate, authorizeRoles('STUDENT'), validate({ body: v.requestCourse }), ctrl.requestCourse);
router.post('/batches/:batchId/enrollments', ...admins, validate({ params: v.batchParams, body: v.enroll }), ctrl.enroll);
router.patch('/enrollments/:enrollmentId/status', ...admins, validate({ params: v.enrollParams, body: v.status }), ctrl.status);
router.post('/enrollments/:enrollmentId/transfer', ...admins, validate({ params: v.enrollParams, body: v.transfer }), ctrl.transfer);
module.exports = router;
