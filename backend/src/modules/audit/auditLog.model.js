const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema(
  {
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // null = system
    action: { type: String, required: true, index: true },
    entityType: { type: String, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    previousStatus: { type: String },
    newStatus: { type: String },
    reason: { type: String, maxlength: 500 },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);
auditSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ actorId: 1, createdAt: -1 });

// Immutability: audit entries can only be inserted.
const blocked = () => { throw new Error('AuditLog entries are immutable'); };
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteMany', 'findOneAndDelete']
  .forEach((op) => auditSchema.pre(op, blocked));
auditSchema.pre('deleteOne', { document: true, query: true }, blocked);
auditSchema.pre('save', function onSave(next) {
  if (!this.isNew) return next(new Error('AuditLog entries are immutable'));
  return next();
});

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditSchema);
