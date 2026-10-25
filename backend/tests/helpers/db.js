const crypto = require('crypto');
const mongoose = require('mongoose');
require('../../src/models');

exports.connect = async () => {
  await mongoose.connect(process.env.TEST_MONGO_URI, { dbName: `t_${crypto.randomBytes(4).toString('hex')}` });
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
};
exports.disconnect = async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};
