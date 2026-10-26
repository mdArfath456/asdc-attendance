const env = require('../config/env');

function calendarParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: env.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
}

// Calendar date in the configured timezone, stored as UTC midnight.
function sessionDateFor(date = new Date()) {
  const { year, month, day } = calendarParts(date);
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
}

function sessionDayEndFor(date = new Date()) {
  const { year, month, day } = calendarParts(date);
  const localEnd = Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999);
  const utcGuess = new Date(localEnd);
  const { year: utcYear, month: utcMonth, day: utcDay, hour, minute, second } = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: env.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(utcGuess).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])
  );
  const representedLocal = Date.UTC(Number(utcYear), Number(utcMonth) - 1, Number(utcDay), Number(hour), Number(minute), Number(second), 999);
  return new Date(localEnd - (representedLocal - utcGuess.getTime()));
}

module.exports = { sessionDateFor, sessionDayEndFor };
