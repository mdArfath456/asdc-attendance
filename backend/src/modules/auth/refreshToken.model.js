const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true }, // SHA-256 of the opaque token
    familyId: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    rotatedAt: { type: Date, default: null },
    successorTokenEncrypted: { type: String, select: false },
    userAgent: String,
    ip: String,
  },
  { timestamps: true }
);
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup

module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', schema);
