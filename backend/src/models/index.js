// Registers every Mongoose model (used by db.js to build indexes).
require('../modules/users/user.model');
require('../modules/courses/course.model');
require('../modules/batches/batch.model');
require('../modules/batches/trainerAssignment.model');
require('../modules/enrollments/enrollment.model');
require('../modules/attendance/attendanceSession.model');
require('../modules/attendance/attendanceRecord.model');
require('../modules/audit/auditLog.model');
require('../modules/auth/refreshToken.model');
