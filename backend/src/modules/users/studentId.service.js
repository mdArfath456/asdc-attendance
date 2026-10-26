const ApiError = require('../../utils/ApiError');
const User = require('./user.model');
const StudentIdCounter = require('./studentIdCounter.model');

const COUNTER_ID = 'student-institutional-id';
const STUDENT_ID_PATTERN = /^ASDC-(\d{4,})$/;
const isDuplicateKey = (error) => error && error.code === 11000;

async function findHighestAssignedSequence() {
  const students = await User.find({ role: 'STUDENT', studentId: /^ASDC-\d{4,}$/ })
    .select('studentId')
    .lean();
  return students.reduce((highest, student) => {
    const match = STUDENT_ID_PATTERN.exec(student.studentId || '');
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
}

async function nextStudentId() {
  const highestAssigned = await findHighestAssignedSequence();
  try {
    await StudentIdCounter.findOneAndUpdate(
      { _id: COUNTER_ID },
      { $max: { sequence: highestAssigned } },
      { upsert: true, new: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
    await StudentIdCounter.updateOne({ _id: COUNTER_ID }, { $max: { sequence: highestAssigned } });
  }

  const counter = await StudentIdCounter.findOneAndUpdate(
    { _id: COUNTER_ID },
    { $inc: { sequence: 1 } },
    { new: true }
  );
  if (!counter || !Number.isSafeInteger(counter.sequence)) {
    throw new ApiError(500, 'STUDENT_ID_ALLOCATION_FAILED', 'Could not allocate a student ID');
  }
  return `ASDC-${String(counter.sequence).padStart(4, '0')}`;
}

async function ensureStudentId(user) {
  if (user.studentId) return user;

  const studentId = await nextStudentId();
  const updatedUser = await User.findOneAndUpdate(
    { _id: user._id, role: 'STUDENT', $or: [{ studentId: { $exists: false } }, { studentId: null }, { studentId: '' }] },
    { $set: { studentId } },
    { new: true }
  );
  if (updatedUser) return updatedUser;

  const currentUser = await User.findById(user._id);
  if (!currentUser || currentUser.role !== 'STUDENT') {
    throw new ApiError(404, 'USER_NOT_FOUND', 'Student account not found');
  }
  if (!currentUser.studentId) {
    throw new ApiError(409, 'STUDENT_ID_ALLOCATION_CONFLICT', 'Could not assign a student ID. Please retry.');
  }
  return currentUser;
}

module.exports = { ensureStudentId, nextStudentId };
