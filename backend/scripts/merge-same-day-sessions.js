const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const env = require('../src/config/env');
const { sessionDateFor } = require('../src/utils/dates');

const ACTIVE_STATUSES = ['SCHEDULED', 'OPEN', 'CLOSED'];
const STATUS_PRIORITY = { PRESENT: 3, LATE: 3, EXCUSED: 2, ABSENT: 1 };

function key(value) {
  return String(value);
}

function sessionDay(session) {
  const start = session.actualStartTime || session.scheduledStart || session.createdAt;
  if (!start || Number.isNaN(new Date(start).getTime())) {
    throw new Error(`Session ${session._id} has no valid start timestamp.`);
  }
  return sessionDateFor(new Date(start));
}

function compareSessions(a, b) {
  return new Date(a.actualStartTime || a.scheduledStart || a.createdAt)
    - new Date(b.actualStartTime || b.scheduledStart || b.createdAt);
}

function chooseBest(records) {
  return [...records].sort((a, b) => {
    const priority = (STATUS_PRIORITY[b.status] || 0) - (STATUS_PRIORITY[a.status] || 0);
    if (priority) return priority;
    const aTime = a.checkInTimestamp ? new Date(a.checkInTimestamp).getTime() : Infinity;
    const bTime = b.checkInTimestamp ? new Date(b.checkInTimestamp).getTime() : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    if (a.status !== b.status) return a.status === 'PRESENT' ? -1 : 1;
    return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
  })[0];
}

function buildMergePlan(sessions, records) {
  const sessionById = new Map(sessions.map((session) => [key(session._id), session]));
  const sessionDates = new Map();
  const recordDateUpdates = [];
  const deleteRecordIds = new Set();
  const deleteSessionIds = new Set();
  const groups = new Map();

  for (const session of sessions) {
    const date = sessionDay(session);
    sessionDates.set(key(session._id), date);
    if (session.status === 'CANCELLED') continue;
    const groupKey = `${key(session.batchId)}:${date.toISOString()}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(session);
  }

  const recordsBySession = new Map();
  for (const record of records) {
    const session = sessionById.get(key(record.sessionId));
    if (!session) throw new Error(`Attendance record ${record._id} references a missing session.`);
    if (session.status === 'CANCELLED') {
      deleteRecordIds.add(record._id);
      continue;
    }
    if (!recordsBySession.has(key(session._id))) recordsBySession.set(key(session._id), []);
    recordsBySession.get(key(session._id)).push(record);
  }

  for (const group of groups.values()) {
    const ordered = [...group].sort(compareSessions);
    const keeper = ordered[0];
    const canonicalDate = sessionDates.get(key(keeper._id));
    const groupRecords = ordered.flatMap((session) => recordsBySession.get(key(session._id)) || []);
    const byEnrollment = new Map();
    for (const record of groupRecords) {
      const enrollmentId = key(record.enrollmentId);
      if (!byEnrollment.has(enrollmentId)) byEnrollment.set(enrollmentId, []);
      byEnrollment.get(enrollmentId).push(record);
    }
    for (const duplicates of byEnrollment.values()) {
      const best = chooseBest(duplicates);
      for (const record of duplicates) {
        if (record._id !== best._id) deleteRecordIds.add(record._id);
      }
      recordDateUpdates.push({ id: best._id, sessionId: keeper._id, sessionDate: canonicalDate });
    }
    for (const session of ordered.slice(1)) deleteSessionIds.add(session._id);
  }

  for (const session of sessions) {
    if (session.status === 'CANCELLED') continue;
    const date = sessionDates.get(key(session._id));
    for (const record of recordsBySession.get(key(session._id)) || []) {
      if (deleteRecordIds.has(record._id)) continue;
      if (!recordDateUpdates.some((update) => key(update.id) === key(record._id))) {
        recordDateUpdates.push({ id: record._id, sessionId: record.sessionId, sessionDate: date });
      }
    }
  }

  return {
    sessionDateUpdates: sessions.map((session) => ({ id: session._id, sessionDate: sessionDates.get(key(session._id)) })),
    recordDateUpdates,
    deleteRecordIds: [...deleteRecordIds],
    deleteSessionIds: [...deleteSessionIds],
    mergedGroups: [...groups.values()].filter((group) => group.length > 1).length,
  };
}

async function runMerge(database, { apply = false, log = () => {} } = {}) {
  const [sessions, records] = await Promise.all([
    database.collection('attendancesessions').find({}).toArray(),
    database.collection('attendancerecords').find({}).toArray(),
  ]);
  const plan = buildMergePlan(sessions, records);
  const counts = {
    sessions: sessions.length,
    records: records.length,
    groupsMerged: plan.mergedGroups,
    sessionsDeleted: plan.deleteSessionIds.length,
    recordsDeleted: plan.deleteRecordIds.length,
    sessionsDateSet: plan.sessionDateUpdates.length,
    recordsMovedOrDated: plan.recordDateUpdates.length,
  };
  log(counts);
  if (apply) await applyMergePlan(database, plan);
  return { plan, counts };
}

async function applyMergePlan(database, plan) {
  const sessions = database.collection('attendancesessions');
  const records = database.collection('attendancerecords');
  if (plan.sessionDateUpdates.length) {
    await sessions.bulkWrite(plan.sessionDateUpdates.map(({ id, sessionDate }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sessionDate } } },
    })), { ordered: true });
  }
  if (plan.deleteRecordIds.length) await records.deleteMany({ _id: { $in: plan.deleteRecordIds } });
  if (plan.recordDateUpdates.length) {
    await records.bulkWrite(plan.recordDateUpdates.map(({ id, sessionId, sessionDate }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sessionId, sessionDate } } },
    })), { ordered: true });
  }
  if (plan.deleteSessionIds.length) await sessions.deleteMany({ _id: { $in: plan.deleteSessionIds } });

  try {
    await sessions.dropIndex('one_open_session_per_batch');
  } catch (error) {
    if (error.codeName !== 'IndexNotFound' && error.code !== 27) throw error;
  }
  await sessions.createIndex(
    { batchId: 1, sessionDate: 1 },
    {
      unique: true,
      partialFilterExpression: {
        $or: [{ status: 'SCHEDULED' }, { status: 'OPEN' }, { status: 'CLOSED' }],
      },
      name: 'one_session_per_batch_per_day',
    }
  );
  await records.createIndex(
    { enrollmentId: 1, sessionDate: 1 },
    { unique: true, name: 'one_attendance_per_enrollment_per_day' }
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--yes')) throw new Error('Only --yes is supported.');
  const apply = args.includes('--yes');
  await mongoose.connect(env.MONGO_URI, { autoIndex: false });
  const db = mongoose.connection.db;
  const uriDb = (() => {
    try { return decodeURIComponent(new URL(env.MONGO_URI).pathname.replace(/^\/+/, '').split('/')[0]) || 'test'; } catch { return '(unknown)'; }
  })();
  console.log(`Database: ${uriDb}`);
  const { counts } = await runMerge(db, {
    apply,
    log: (result) => console.log(JSON.stringify(result, null, 2)),
  });
  if (apply) console.log('Merge applied and daily unique indexes created.');
  else console.log('Dry run only; no data or indexes changed. Re-run with -- --yes to apply.');
  return counts;
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(async () => { if (mongoose.connection.readyState) await mongoose.disconnect(); });
}

module.exports = { buildMergePlan, chooseBest, runMerge, applyMergePlan };
