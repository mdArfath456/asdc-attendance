const mongoose = require('mongoose');

const studentIdCounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, required: true, min: 0 },
});

module.exports = mongoose.models.StudentIdCounter
  || mongoose.model('StudentIdCounter', studentIdCounterSchema);
