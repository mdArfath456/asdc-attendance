const { MongoMemoryServer, MongoMemoryReplSet } = require('mongodb-memory-server');

// Default: a plain standalone MongoDB (no replica set). TEST_REPLSET=1 also exercises the
// transaction code path. Use a local binary offline: MONGOMS_SYSTEM_BINARY=/path/to/mongod npm test
module.exports = async () => {
  const srv = process.env.TEST_REPLSET
    ? await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } })
    : await MongoMemoryServer.create();
  global.__MONGO__ = srv;
  process.env.TEST_MONGO_URI = srv.getUri();
};
