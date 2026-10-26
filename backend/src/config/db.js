const mongoose = require('mongoose');
require('../models');

mongoose.set('strictQuery', true);

async function connectDb(uri) {
  const diagnosticsEnabled = process.env.PERF_DIAGNOSTICS === '1';
  const startedAt = process.hrtime.bigint();
  if (diagnosticsEnabled) {
    mongoose.connection.on('disconnected', () => console.warn(JSON.stringify({ event: 'mongo-connection-state', state: 'disconnected' })));
    mongoose.connection.on('reconnected', () => console.info(JSON.stringify({ event: 'mongo-connection-state', state: 'reconnected' })));
  }
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000, monitorCommands: diagnosticsEnabled });
  // Build declared indexes (unique / partial / sparse) before serving traffic.
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  if (diagnosticsEnabled) {
    const client = mongoose.connection.getClient();
    const startedCommands = new Map();
    client.on('commandStarted', (event) => startedCommands.set(event.requestId, process.hrtime.bigint()));
    client.on('commandSucceeded', (event) => {
      const start = startedCommands.get(event.requestId);
      if (start) {
        startedCommands.delete(event.requestId);
        console.info(JSON.stringify({
          event: 'mongo-performance',
          command: event.commandName,
          durationMs: Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)),
        }));
      }
    });
    client.on('commandFailed', (event) => {
      const start = startedCommands.get(event.requestId);
      startedCommands.delete(event.requestId);
      console.warn(JSON.stringify({
        event: 'mongo-performance',
        command: event.commandName,
        durationMs: start ? Number((Number(process.hrtime.bigint() - start) / 1e6).toFixed(2)) : null,
        failed: true,
      }));
    });
    console.info(JSON.stringify({
      event: 'mongo-connect-performance',
      durationMs: Number((Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(2)),
      indexInitializationComplete: true,
    }));
  }
  return mongoose.connection;
}

module.exports = { connectDb, disconnectDb: () => mongoose.disconnect() };
