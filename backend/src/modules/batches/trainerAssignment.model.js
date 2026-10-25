const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', required: true },
    trainerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isPrimary: { type: Boolean, default: false },
    canManageSessions: { type: Boolean, default: false }, // explicit authorisation to run sessions
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
schema.index({ batchId: 1, trainerId: 1 }, { unique: true });

module.exports = mongoose.models.TrainerAssignment || mongoose.model('TrainerAssignment', schema);
