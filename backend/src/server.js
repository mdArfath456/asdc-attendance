const http = require('http');
const mongoose = require('mongoose');
const env = require('./config/env');
const app = require('./app');
const { connectDb } = require('./config/db');
const realtime = require('./config/realtime');
const { autoCloseExpiredSessions } = require('./modules/attendance/session.service');
const { bootstrapAdmin } = require('./modules/auth/adminBootstrap.service');
const courses = require('./modules/courses/courses.service');

async function main() {
  await connectDb(env.MONGO_URI);
  await bootstrapAdmin();
  await courses.ensureAllCourseBatches();
  const { transactionsSupported } = require('./utils/transaction');
  console.log(`MongoDB connected (${(await transactionsSupported()) ? 'replica set: using transactions' : 'standalone: using ordered writes with rollback'})`);
  const server = http.createServer(app);
  realtime.init(server);
  server.listen(env.PORT, () => console.log(`ASDC API listening on :${env.PORT} (${env.NODE_ENV})`));

  // Auto-close sessions past their scheduled end (also generates ABSENT records).
  const timer = setInterval(() => autoCloseExpiredSessions().catch((e) => console.error('[auto-close]', e.message)), env.AUTO_CLOSE_INTERVAL_SECONDS * 1000);

  const shutdown = async () => {
    clearInterval(timer);
    server.close(async () => { await mongoose.disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
