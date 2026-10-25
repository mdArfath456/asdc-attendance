const router = require('express').Router();
const { authenticate, authorizeRoles, authorizeBatchAccess } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./batches.controller');
const v = require('./batches.validation');

router.use(authenticate);
router.get('/', authorizeRoles('ADMIN', 'TRAINER'), validate({ query: v.listQuery }), ctrl.list);
router.get('/:batchId/students', authorizeRoles('ADMIN', 'TRAINER'), validate({ params: v.batchParams }), authorizeBatchAccess(), ctrl.students);
module.exports = router;
