const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./audit.controller');
const v = require('./audit.validation');

router.get('/audit-logs', authenticate, authorizeRoles('ADMIN'), validate({ query: v.listQuery }), ctrl.list);
module.exports = router;
