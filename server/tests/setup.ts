/**
 * Jest Test Setup
 * 
 * This file runs before all tests. It loads environment variables
 * and performs any necessary global setup.
 */

import 'dotenv/config';

// Set test environment
process.env.NODE_ENV = 'test';

// Global error handlers for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in test:', reason);
});

// Log test environment
console.log('[Test Setup] Environment:', process.env.NODE_ENV);
console.log('[Test Setup] Database URL configured:', !!process.env.DATABASE_URL);
