const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 4000 },
    durationHours: { type: Number, min: 0 },
    isPublic: { type: Boolean, default: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Course || mongoose.model('Course', courseSchema);
