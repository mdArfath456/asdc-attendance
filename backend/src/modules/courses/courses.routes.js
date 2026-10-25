const router = require('express').Router();
const { authenticate, authorizeRoles } = require('../../middleware/auth');
const validate = require('../../middleware/validate');
const ctrl = require('./courses.controller');
const v = require('./courses.validation');

// Public catalogues expose only active offerings.
router.get('/public', ctrl.listPublic);
router.get('/public/:slug', validate({ params: v.slugParams }), ctrl.getPublic);
router.get('/active', ctrl.listActive);

router.get('/', authenticate, authorizeRoles('ADMIN', 'TRAINER'), ctrl.list);
router.get('/students', authenticate, authorizeRoles('ADMIN'), validate({ query: v.studentSearch }), ctrl.groupedStudents);
router.get('/requested-students', authenticate, authorizeRoles('ADMIN'), validate({ query: v.studentSearch }), ctrl.requestedStudents);
router.get('/:courseId', authenticate, authorizeRoles('ADMIN', 'TRAINER'), validate({ params: v.idParams }), ctrl.details);
router.post('/', authenticate, authorizeRoles('ADMIN'), validate({ body: v.create }), ctrl.create);
router.patch('/:courseId', authenticate, authorizeRoles('ADMIN'), validate({ params: v.idParams, body: v.update }), ctrl.update);
router.post('/:courseId/enroll-requested', authenticate, authorizeRoles('ADMIN'), validate({ params: v.idParams, body: v.enrollRequested }), ctrl.enrollRequested);
router.post('/:courseId/trainers', authenticate, authorizeRoles('ADMIN'), validate({ params: v.idParams, body: v.assignTrainer }), ctrl.assignTrainer);
router.delete('/:courseId/trainers/:trainerId', authenticate, authorizeRoles('ADMIN'), validate({ params: v.trainerParams }), ctrl.removeTrainer);
module.exports = router;
