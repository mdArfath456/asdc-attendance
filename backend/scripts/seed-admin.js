const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
require('../src/models');

const env = require('../src/config/env');
const { bootstrapAdmin } = require('../src/modules/auth/adminBootstrap.service');

async function main() {
  if (!env.ADMIN_PASSWORD) {
    throw new Error('Set ADMIN_PASSWORD in backend/.env before seeding password sign-in.');
  }

  await mongoose.connect(env.MONGO_URI);
  await bootstrapAdmin();
  console.log('Administrator account seeded from backend/.env.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error(`Admin seeding failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState) await mongoose.disconnect();
    });
}

module.exports = { main };
