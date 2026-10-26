const { z } = require('zod');
exports.login = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128),
  adminOnly: z.boolean().optional(),
}).strict();
exports.google = z.object({ idToken: z.string().min(20).max(4096) }).strict();
exports.googleLogin = z.object({ idToken: z.string().min(20).max(4096), adminOnly: z.boolean().optional() }).strict();
const strongPassword = z.string().min(12).max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol');
const profileFields = {
  mobileNumber: z.string().trim().min(7, 'Enter a valid mobile number').max(32)
    .regex(/^\+?[\d\s().-]+$/)
    .refine((value) => value.replace(/\D/g, '').length >= 7, 'Enter a valid mobile number')
    .optional(),
  fatherName: z.string().trim().min(2).max(120).refine((value) => !/[<>]/.test(value), 'Enter a valid name').optional(),
  motherName: z.string().trim().min(2).max(120).refine((value) => !/[<>]/.test(value), 'Enter a valid name').optional(),
};
exports.register = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: strongPassword,
  ...profileFields,
  courseId: require('../../utils/zodHelpers').objectId.optional(),
  requestedCourseName: z.string().trim().min(2).max(80).optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.courseId) === Boolean(value.requestedCourseName)) {
    ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'Choose a course or enter a requested course name' });
  }
  if (value.requestedCourseName && /[<>]/.test(value.requestedCourseName)) {
    ctx.addIssue({ code: 'custom', path: ['requestedCourseName'], message: 'Course name cannot contain markup characters' });
  }
});
exports.registerGoogle = z.object({
  idToken: z.string().min(20).max(4096),
  ...profileFields,
  courseId: require('../../utils/zodHelpers').objectId.optional(),
  requestedCourseName: z.string().trim().min(2).max(80).optional(),
}).strict().superRefine((value, ctx) => {
  if (Boolean(value.courseId) === Boolean(value.requestedCourseName)) {
    ctx.addIssue({ code: 'custom', path: ['courseId'], message: 'Choose a course or enter a requested course name' });
  }
  if (value.requestedCourseName && /[<>]/.test(value.requestedCourseName)) {
    ctx.addIssue({ code: 'custom', path: ['requestedCourseName'], message: 'Course name cannot contain markup characters' });
  }
});
