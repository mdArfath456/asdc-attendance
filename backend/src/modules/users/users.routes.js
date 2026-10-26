const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./users.controller');
const v = require('./users.validation');

router.patch('/me/preferences', authenticate, validate({ body: v.preferencesBody }), ctrl.setPreferences);
router.get('/me/id-card', authenticate, authorizeRoles('STUDENT'), ctrl.idCard);
router.use(authenticate, authorizeRoles('ADMIN'));
router.get('/', validate({ query: v.listQuery }), ctrl.list);
router.patch('/:userId/status', validate({ params: v.userIdParams, body: v.statusBody }), ctrl.setStatus);
module.exports = router;
