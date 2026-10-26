const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const { qrRotateLimiter, checkInLimiter } = require('../../middleware/rateLimiters');
const ctrl = require('./attendance.controller');
const v = require('./attendance.validation');

const staff = [authenticate, authorizeRoles('ADMIN', 'TRAINER')];
const admins = [authenticate, authorizeRoles('ADMIN')];
const students = [authenticate, authorizeRoles('STUDENT')];

// Session lifecycle (batch-level authorisation is enforced inside the service)
router.get('/attendance-sessions/today', ...staff, ctrl.todayForStaff);
router.post('/batches/:batchId/attendance-sessions', ...staff, validate({ params: v.batchParams, body: v.start }), ctrl.start);
router.get('/batches/:batchId/attendance-sessions/today', ...staff, validate({ params: v.batchParams }), ctrl.todayForBatch);
router.get('/batches/:batchId/attendance-sessions', ...staff, validate({ params: v.batchParams }), ctrl.listForBatch);
router.get('/attendance-sessions/:sessionId', ...staff, validate({ params: v.sessionParams }), ctrl.get);
router.post('/attendance-sessions/:sessionId/qr-token', ...staff, qrRotateLimiter, validate({ params: v.sessionParams }), ctrl.rotate);
router.post('/attendance-sessions/:sessionId/close', ...staff, validate({ params: v.sessionParams }), ctrl.close);
router.post('/attendance-sessions/:sessionId/cancel', ...staff, validate({ params: v.sessionParams, body: v.cancel }), ctrl.cancel);
router.post('/attendance-sessions/:sessionId/reopen', ...staff, validate({ params: v.sessionParams }), ctrl.reopen);
router.get('/attendance-sessions/:sessionId/records', ...staff, validate({ params: v.sessionParams }), ctrl.records);

// Student
router.post('/attendance/check-in', ...students, checkInLimiter, validate({ body: v.checkIn }), ctrl.checkIn);
router.get('/attendance/today', ...students, validate({ query: v.emptyQuery }), ctrl.studentToday);
router.get('/attendance/my-history', ...students, validate({ query: v.historyQuery }), ctrl.myHistory);

// Corrections (Admin / Super Admin only)
router.patch('/attendance-records/:recordId', ...admins, validate({ params: v.recordParams, body: v.correct }), ctrl.correct);
module.exports = router;
