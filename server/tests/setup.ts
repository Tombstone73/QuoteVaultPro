/**
 * Jest Test Setup
 * 
 * This file runs before all tests. It loads environment variables
 * and performs any necessary global setup.
 */

import 'dotenv/config';
import { safeTestDatabaseUrl } from './helpers/safeTestDatabase';

// Set test environment
process.env.NODE_ENV = 'test';

// DB-backed tests must opt into a separate database. When it is configured,
// select it before any DB modules load and bring it through the full immutable
// migrations_v2 stream (including EPS test/live credentials migration 0130).
// Validate before replacing any app URL.  An unsafe configured TEST_DATABASE_URL
// must fail the run rather than accidentally migrate or write to a shared DB.
const testDatabaseUrl = safeTestDatabaseUrl(process.env);
if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.MIGRATION_DATABASE_URL = testDatabaseUrl;
  process.env.DIRECT_DATABASE_URL = testDatabaseUrl;
  beforeAll(async () => {
    const { runMigrations } = await import('../runMigrations');
    await runMigrations();
  });
}

// Global error handlers for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in test:', reason);
});

// Log test environment
console.log('[Test Setup] Environment:', process.env.NODE_ENV);
console.log('[Test Setup] Database URL configured:', !!process.env.DATABASE_URL);
console.log('[Test Setup] Dedicated test database migrations enabled:', !!testDatabaseUrl);
