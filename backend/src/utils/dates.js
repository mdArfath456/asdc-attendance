const env = require('../config/env');

// Calendar date (in the configured timezone) stored as UTC midnight.
function sessionDateFor(date = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: env.TIMEZONE }).format(date);
  return new Date(`${ymd}T00:00:00.000Z`);
}
module.exports = { sessionDateFor };
