const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');

const COLLECTION_ORDER = [
  'attendancerecords',
  'attendancesessions',
  'enrollments',
  'trainerassignments',
  'batches',
  'courses',
  'refreshtokens',
  'auditlogs',
  'users',
];
const DUMMY_COLLECTIONS = COLLECTION_ORDER;

function parseArgs(args) {
  const options = {
    confirmed: false,
    mode: 'dummy',
    keepAdmin: false,
    emails: [],
  };

  for (const arg of args) {
    if (arg === '--yes') options.confirmed = true;
    else if (arg === '--dummy') options.mode = 'dummy';
    else if (arg === '--all') options.mode = 'all';
    else if (arg === '--keep-admin') options.keepAdmin = true;
    else if (arg.startsWith('--email=')) {
      const email = arg.slice('--email='.length).trim().toLowerCase();
      if (!email) throw new Error('--email requires an address.');
      options.emails.push(email);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (args.includes('--dummy') && args.includes('--all')) {
    throw new Error('Use either --dummy or --all, not both.');
  }
  return options;
}

function databaseNameFromUri(uri) {
  if (!uri) return '(unconfigured)';
  try {
    const url = new URL(uri);
    const name = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/')[0]);
    return name || 'test';
  } catch {
    return '(unavailable)';
  }
}

function objectIds(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function toObjectIds(values) {
  return objectIds(values)
    .filter((value) => mongoose.isValidObjectId(value))
    .map((value) => new mongoose.Types.ObjectId(value));
}

function orFilter(filters) {
  const valid = filters.filter((filter) => Object.keys(filter).length > 0);
  if (!valid.length) return { _id: { $in: [] } };
  return valid.length === 1 ? valid[0] : { $or: valid };
}

async function findDummyTargets(database, { adminEmail, emails }) {
  const usersCollection = database.collection('users');
  const emailPatterns = emails.map((email) => new RegExp(`^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  const userFilter = {
    $or: [
      { email: /@asdc\.local$/i },
      { name: /^(Google Student|Student \d+)$/ },
      ...(emailPatterns.length ? [{ email: { $in: emailPatterns } }] : []),
    ],
  };
  if (adminEmail) {
    userFilter.$and = [{ $expr: { $ne: [{ $toLower: '$email' }, adminEmail] } }];
  }
  const users = await usersCollection.find(userFilter, { projection: { _id: 1 } }).toArray();
  const userIds = toObjectIds(users.map((user) => user._id));
  const userIdStrings = objectIds(users.map((user) => user._id));

  const courses = await database.collection('courses')
    .find({ code: 'FSD' }, { projection: { _id: 1 } }).toArray();
  const courseIds = toObjectIds(courses.map((course) => course._id));

  const batches = await database.collection('batches')
    .find({
      $or: [
        { name: 'FSD-2026-A' },
        ...(courseIds.length ? [{ courseId: { $in: courseIds } }] : []),
      ],
    }, { projection: { _id: 1 } }).toArray();
  const batchIds = toObjectIds(batches.map((batch) => batch._id));
  const allCourseIds = courseIds;

  const enrollmentFilter = orFilter([
    userIds.length ? { studentId: { $in: userIds } } : {},
    allCourseIds.length ? { courseId: { $in: allCourseIds } } : {},
    batchIds.length ? { batchId: { $in: batchIds } } : {},
  ]);
  const enrollments = await database.collection('enrollments')
    .find(enrollmentFilter, { projection: { _id: 1 } }).toArray();
  const enrollmentIds = toObjectIds(enrollments.map((enrollment) => enrollment._id));

  const sessions = await database.collection('attendancesessions')
    .find(batchIds.length ? { batchId: { $in: batchIds } } : { _id: { $in: [] } }, { projection: { _id: 1 } }).toArray();
  const sessionIds = toObjectIds(sessions.map((session) => session._id));

  const trainers = await database.collection('trainerassignments')
    .find(orFilter([
      batchIds.length ? { batchId: { $in: batchIds } } : {},
      userIds.length ? { trainerId: { $in: userIds } } : {},
    ]), { projection: { _id: 1 } }).toArray();
  const trainerAssignmentIds = toObjectIds(trainers.map((assignment) => assignment._id));

  const records = await database.collection('attendancerecords')
    .find(orFilter([
      sessionIds.length ? { sessionId: { $in: sessionIds } } : {},
      userIds.length ? { studentId: { $in: userIds } } : {},
      enrollmentIds.length ? { enrollmentId: { $in: enrollmentIds } } : {},
    ]), { projection: { _id: 1 } }).toArray();
  const recordIds = toObjectIds(records.map((record) => record._id));

  const refreshTokens = await database.collection('refreshtokens')
    .find(userIds.length ? { userId: { $in: userIds } } : { _id: { $in: [] } }, { projection: { _id: 1 } }).toArray();

  const linkedIds = toObjectIds([
    ...userIds,
    ...allCourseIds,
    ...batchIds,
    ...enrollmentIds,
    ...sessionIds,
    ...trainerAssignmentIds,
    ...recordIds,
    ...refreshTokens.map((token) => token._id),
  ]);
  const linkedIdStrings = objectIds([
    ...userIdStrings,
    ...allCourseIds,
    ...batchIds,
    ...enrollmentIds,
    ...sessionIds,
    ...trainerAssignmentIds,
    ...recordIds,
    ...refreshTokens.map((token) => token._id),
  ]);
  const auditActorIds = [...userIds, ...userIdStrings];
  const auditEntityIds = [...linkedIds, ...linkedIdStrings];

  return new Map([
    ['attendancerecords', { filter: recordIds.length ? { _id: { $in: recordIds } } : { _id: { $in: [] } } }],
    ['attendancesessions', { filter: sessionIds.length ? { _id: { $in: sessionIds } } : { _id: { $in: [] } } }],
    ['enrollments', { filter: enrollmentIds.length ? { _id: { $in: enrollmentIds } } : { _id: { $in: [] } } }],
    ['trainerassignments', { filter: trainers.length ? { _id: { $in: trainers.map((item) => item._id) } } : { _id: { $in: [] } } }],
    ['batches', { filter: batchIds.length ? { _id: { $in: batchIds } } : { _id: { $in: [] } } }],
    ['courses', { filter: allCourseIds.length ? { _id: { $in: allCourseIds } } : { _id: { $in: [] } } }],
    ['refreshtokens', { filter: refreshTokens.length ? { _id: { $in: refreshTokens.map((item) => item._id) } } : { _id: { $in: [] } } }],
    ['auditlogs', { filter: orFilter([
      auditActorIds.length ? { actorId: { $in: auditActorIds } } : {},
      auditEntityIds.length ? { entityId: { $in: auditEntityIds } } : {},
    ]) }],
    ['users', { filter: userIds.length ? { _id: { $in: userIds } } : { _id: { $in: [] } } }],
  ]);
}

function allDocumentsFilter(collectionName, adminEmail, keepAdmin) {
  if (collectionName === 'users' && keepAdmin) {
    return { $expr: { $ne: [{ $toLower: '$email' }, adminEmail] } };
  }
  return {};
}

async function cleanupDatabase(database, options, log = console.log) {
  const adminEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (options.mode === 'dummy' && !adminEmail) {
    throw new Error('ADMIN_EMAIL must be configured to protect the administrator in dummy mode.');
  }
  if (options.mode === 'all' && options.keepAdmin && !adminEmail) {
    throw new Error('--keep-admin requires ADMIN_EMAIL to be configured.');
  }

  const collections = options.mode === 'all'
    ? (await database.listCollections({}, { nameOnly: true }).toArray())
      .map(({ name }) => name)
      .filter((name) => !name.startsWith('system.'))
    : DUMMY_COLLECTIONS;
  const dummyTargets = options.mode === 'dummy'
    ? await findDummyTargets(database, { adminEmail, emails: options.emails })
    : null;

  for (const name of collections) {
    let filter;
    if (options.mode === 'dummy') {
      filter = dummyTargets.get(name).filter;
    } else {
      filter = allDocumentsFilter(name, adminEmail, options.keepAdmin);
    }
    let count;
    try {
      count = await database.collection(name).countDocuments(filter);
    } catch {
      throw new Error(`Could not count documents in collection "${name}".`);
    }
    if (!options.confirmed) {
      log(`would delete ${count} ${name}`);
      continue;
    }
    if (options.confirmed && count > 0) {
      try {
        const result = await database.collection(name).deleteMany(filter);
        log(`deleted ${result.deletedCount} ${name}`);
      } catch {
        throw new Error(`Could not delete documents from collection "${name}".`);
      }
    } else {
      log(`deleted 0 ${name}`);
    }
  }
}

async function resetDatabase(database, { confirmed, log = console.log }) {
  log(`Database: ${database.databaseName}`);
  log(`Mode: all${confirmed ? ' (delete)' : ' (dry run)'}`);
  if (!confirmed) throw new Error('Refusing to delete documents without the --yes confirmation flag.');

  const collections = (await database.listCollections({}, { nameOnly: true }).toArray())
    .map(({ name }) => name)
    .filter((name) => !name.startsWith('system.'));
  for (const name of collections) {
    let result;
    try {
      result = await database.collection(name).deleteMany({});
    } catch {
      throw new Error(`Could not delete documents from collection "${name}".`);
    }
    log(`deleted ${result.deletedCount || 0} ${name}`);
  }
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.log(`Database: ${databaseNameFromUri(process.env.MONGO_URI)}`);
    console.log('Mode: unavailable');
    throw error;
  }

  const databaseName = databaseNameFromUri(process.env.MONGO_URI);
  console.log(`Database: ${databaseName}`);
  console.log(`Mode: ${options.mode}${options.confirmed ? ' (delete)' : ' (dry run)'}`);

  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured in backend/.env.');
  try {
    await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  } catch {
    throw new Error('Could not connect to the configured MongoDB database.');
  }
  try {
    await cleanupDatabase(mongoose.connection.db, options);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Database cleanup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { cleanupDatabase, databaseNameFromUri, findDummyTargets, parseArgs, resetDatabase };
