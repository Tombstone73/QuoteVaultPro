import base from './jest.config.js';

// Real local PostgreSQL, canonical migrations, no deployed Neon/WebSocket proxy.
export default {
  ...base,
  testMatch: ['**/tests/inboundEmail.postgres.integration.ts', '**/tests/quoteRoutingAndConversion.contract.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/server/tests/setupInboundPostgres.ts'],
  moduleNameMapper: {
    '^@neondatabase/serverless$': '<rootDir>/server/tests/helpers/localPostgresDriver.mjs',
    '^drizzle-orm/neon-serverless$': 'drizzle-orm/node-postgres',
    '^drizzle-orm/neon-serverless/migrator$': 'drizzle-orm/node-postgres/migrator',
    ...base.moduleNameMapper,
  },
};
