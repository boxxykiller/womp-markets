// Integration tests need a real Postgres and self-skip without
// DATABASE_URL_TEST, so `npm test` still runs the unit suite on a bare
// checkout. Pointing DATABASE_URL at the test database here means the Prisma
// client picks it up without every test file having to.
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
process.env.SESSION_SECRET ||= 'test-secret';
