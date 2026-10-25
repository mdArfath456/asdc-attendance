require('dotenv').config();
const { z } = require('zod');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(5000),
    MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_EXPIRES: z.string().default('15m'),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
    COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    QR_SIGNING_SECRET: z.string().min(32, 'QR_SIGNING_SECRET must be at least 32 characters'),
    GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required'),
    ADMIN_EMAIL: z.string().trim().toLowerCase().email(),
    ADMIN_PASSWORD: z.string().min(12).optional().or(z.literal('')),
    CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
    SITE_URL: z.string().url().default('http://localhost:5173'),
    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    TIMEZONE: z.string().default('Asia/Kolkata'),
    SESSION_DURATION_MINUTES: z.coerce.number().int().min(5).max(600).default(90),
    QR_REFRESH_SECONDS: z.coerce.number().int().min(5).max(120).default(20),
    QR_GRACE_SECONDS: z.coerce.number().int().min(0).max(60).default(10),
    LATE_THRESHOLD_MINUTES: z.coerce.number().int().min(0).max(240).default(10),
    LATE_WEIGHT: z.coerce.number().min(0).max(1).default(0.5),
    EXCUSED_POLICY: z.enum(['EXCLUDE', 'FULL_CREDIT']).default('EXCLUDE'),
    ATTENDANCE_THRESHOLD: z.coerce.number().min(0).max(100).default(75),
    AUTO_CLOSE_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.BCRYPT_COST < 12) {
      ctx.addIssue({ code: 'custom', path: ['BCRYPT_COST'], message: 'BCRYPT_COST must be >= 12 in production' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const msg = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${msg}`);
}

module.exports = Object.freeze({
  ...parsed.data,
  ADMIN_PASSWORD: parsed.data.ADMIN_PASSWORD || undefined,
  isProd: parsed.data.NODE_ENV === 'production',
  isTest: parsed.data.NODE_ENV === 'test',
  clientOrigins: parsed.data.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
});
