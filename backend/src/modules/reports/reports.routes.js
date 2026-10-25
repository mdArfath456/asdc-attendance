const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./reports.controller');
const v = require('./reports.validation');

const staff = [authenticate, authorizeRoles('ADMIN', 'TRAINER')];
router.get('/attendance/reports', ...staff, validate({ query: v.reportQuery }), ctrl.report);
router.get('/attendance/reports/export', authenticate, authorizeRoles('ADMIN'), validate({ query: v.exportQuery }), ctrl.export);
router.get('/attendance/summary', ...staff, validate({ query: v.summaryQuery }), ctrl.summary);
module.exports = router;
