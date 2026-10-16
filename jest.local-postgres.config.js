import baseConfig from './jest.config.js';

// The production Neon driver uses a WebSocket proxy, even for a loopback URL.
// This test-only mapping lets the canonical services run against a disposable
// local PostgreSQL server with real transactions.
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required for local PostgreSQL tests.');
const host = new URL(testUrl).hostname;
if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
  throw new Error('The local PostgreSQL Jest configuration accepts loopback hosts only.');
}

export default {
  ...baseConfig,
  // The disposable database is bootstrapped with the repository's db:push.
  // migrations_v2 starts from a production schema and cannot build an empty DB.
  setupFilesAfterEnv: ['<rootDir>/server/tests/setupLocalPostgres.ts'],
  testMatch: ['**/tests/**/*.postgres.integration.ts'],
  moduleNameMapper: {
    '^@neondatabase/serverless$': '<rootDir>/server/tests/helpers/localPostgresDriver.mjs',
    '^drizzle-orm/neon-serverless$': 'drizzle-orm/node-postgres',
    ...baseConfig.moduleNameMapper,
  },
};
