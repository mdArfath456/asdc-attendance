import { z } from 'zod';

export const strongPassword = z.string().min(12).max(128, 'Password must be 128 characters or fewer')
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol');

export const registerNameSchema = z.string().trim().min(2, 'Enter your name').max(120);
export const registerEmailSchema = z.string().trim().toLowerCase().email('Enter a valid email').max(254);
const profileFields = {
  mobileNumber: z.string().trim().max(32).refine((value) => !value || (/^[+]?[0-9\s().-]+$/.test(value) && value.replace(/\D/g, '').length >= 7), 'Enter a valid mobile number').optional(),
  fatherName: z.string().trim().max(120).refine((value) => !value || (value.length >= 2 && !/[<>]/.test(value)), 'Enter a valid name').optional(),
  motherName: z.string().trim().max(120).refine((value) => !value || (value.length >= 2 && !/[<>]/.test(value)), 'Enter a valid name').optional(),
};
export const studentProfileSchema = z.object(profileFields);

export const registerSchema = z.object({
  name: registerNameSchema,
  email: registerEmailSchema,
  password: strongPassword,
  ...profileFields,
  courseChoice: z.string().min(1, 'Choose a course'),
  requestedCourseName: z.string().trim().min(2, 'Enter a course name').max(80, 'Course names must be 80 characters or fewer').refine((name) => !/[<>]/.test(name), 'Course name cannot contain markup characters').optional(),
}).superRefine((value, ctx) => {
  if (value.courseChoice === 'OTHER' && !value.requestedCourseName) {
    ctx.addIssue({ code: 'custom', path: ['requestedCourseName'], message: 'Enter a course name' });
  }
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  password: z.string().min(1, 'Enter your password').max(128),
});

export const courseSelectionSchema = z.object({
  courseChoice: z.string().min(1, 'Choose a course'),
  requestedCourseName: z.string().trim().min(2, 'Enter a course name').max(80, 'Course names must be 80 characters or fewer').refine((name) => !/[<>]/.test(name), 'Course name cannot contain markup characters').optional(),
}).superRefine((value, ctx) => {
  if (value.courseChoice === 'OTHER' && !value.requestedCourseName) {
    ctx.addIssue({ code: 'custom', path: ['requestedCourseName'], message: 'Enter a course name' });
  }
});

export const courseSchema = z.object({
  name: z.string().trim().min(2, 'Enter a course name').max(160),
  code: z.string().trim().min(2, 'Enter a course code').max(30),
  description: z.string().trim().max(4000, 'Description must be 4000 characters or fewer').optional(),
});

export const trainerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
});

export const sessionSchema = z.object({
  lateThresholdMinutes: z.coerce.number().int().min(0).max(240),
  durationMinutes: z.coerce.number().int().min(5).max(600),
});

export const correctionSchema = z.object({
  reason: z.string().trim().min(5, 'Enter a reason of at least 5 characters').max(500),
});

export function validate(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return { values: result.data, errors: {} };
  const errors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { values: null, errors };
}

export function registrationCoursePayload(choice, requestedCourseName) {
  return choice === 'OTHER'
    ? { requestedCourseName: requestedCourseName.trim() }
    : { courseId: choice };
}

export function studentProfilePayload(values) {
  return Object.fromEntries(
    ['mobileNumber', 'fatherName', 'motherName']
      .filter((key) => values[key]?.trim())
      .map((key) => [key, values[key].trim()])
  );
}
