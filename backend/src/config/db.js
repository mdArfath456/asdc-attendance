const mongoose = require('mongoose');
require('../models');

mongoose.set('strictQuery', true);

async function connectDb(uri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  // Build declared indexes (unique / partial / sparse) before serving traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return mongoose.connection;
}

module.exports = { connectDb, disconnectDb: () => mongoose.disconnect() };
