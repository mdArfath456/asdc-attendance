const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
require('../src/models');
const env = require('../src/config/env');
const User = require('../src/modules/users/user.model');
const { ensureStudentId } = require('../src/modules/users/studentId.service');

async function main() {
  await mongoose.connect(env.MONGO_URI);
  await Promise.all(Object.values(mongoose.models).map((model) => model.init()));

  const students = await User.find({
    role: 'STUDENT',
    $or: [{ studentId: { $exists: false } }, { studentId: null }, { studentId: '' }],
  }).sort({ _id: 1 });
  let assigned = 0;
  for (const student of students) {
    await ensureStudentId(student);
    assigned += 1;
  }
  console.log(`Student ID backfill complete. IDs assigned: ${assigned}. Existing student records were preserved.`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Student ID backfill failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    });
}

module.exports = { main };
