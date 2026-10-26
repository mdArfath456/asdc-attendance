const mongoose = require('mongoose');
const { ROLES, USER_STATUS, AUTH_PROVIDERS } = require('../../utils/constants');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    role: { type: String, enum: ROLES, required: true, index: true },
    studentId: { type: String, trim: true, uppercase: true, sparse: true, unique: true },
    mobileNumber: { type: String, trim: true, maxlength: 32 },
    fatherName: { type: String, trim: true, maxlength: 120 },
    motherName: { type: String, trim: true, maxlength: 120 },
    status: { type: String, enum: USER_STATUS, default: 'ACTIVE', index: true },
    passwordHash: {
      type: String,
      select: false,
      required: [
        function requiredForLocal() {
          return this.isNew && Array.isArray(this.authProviders) && this.authProviders.includes('LOCAL');
        },
        'passwordHash is required when LOCAL authentication is enabled',
      ],
    },
    googleId: { type: String, unique: true, sparse: true }, // Google immutable `sub`
    authProviders: {
      type: [{ type: String, enum: AUTH_PROVIDERS }],
      default: ['LOCAL'],
      validate: [(v) => v.length > 0, 'At least one auth provider is required'],
    },
    avatarUrl: { type: String, trim: true },
    requestedCourseName: { type: String, trim: true, maxlength: 80 },
    themePreference: { type: String, enum: ['light', 'dark'], default: 'light' },
  },
  { timestamps: true }
);

userSchema.pre('validate', function validateAdminIdentity(next) {
  const env = require('../../config/env');
  if (this.role === 'ADMIN' && this.email !== env.ADMIN_EMAIL) {
    this.invalidate('role', 'Only ADMIN_EMAIL may have the ADMIN role');
  }
  if (this.email === env.ADMIN_EMAIL && this.role !== 'ADMIN') {
    this.invalidate('role', 'ADMIN_EMAIL must retain the ADMIN role');
  }
  next();
});

userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
