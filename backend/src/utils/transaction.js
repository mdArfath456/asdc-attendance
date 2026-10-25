const mongoose = require('mongoose');

// Works on BOTH a plain (standalone) MongoDB and a replica set / Atlas cluster.
//  - replica set / mongos : real multi-document transaction
//  - standalone           : fn(null) runs without a session; callers order their writes so a
//                           failure can be rolled back (see transfer / correction / close).
let supported = null;
async function transactionsSupported() {
  if (supported !== null) return supported;
  try {
    const h = await mongoose.connection.db.admin().command({ hello: 1 });
    supported = !!(h.setName || h.msg === 'isdbgrid');
  } catch (e) {
    supported = false;
  }
  return supported;
}

async function runInTransaction(fn) {
  if (!(await transactionsSupported())) return fn(null);
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { runInTransaction, transactionsSupported };
