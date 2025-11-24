#!/usr/bin/env tsx
/**
 * CLI script to sync users to customers
 * Run with: npx tsx sync-users-customers.ts
 */

import 'dotenv/config';
import { syncUsersToCustomers } from './server/db/syncUsersToCustomers';

async function main() {
  console.log('='.repeat(60));
  console.log('SYNCING USERS TO CUSTOMERS');
  console.log('='.repeat(60));

  try {
    const result = await syncUsersToCustomers();

    console.log('\n' + '='.repeat(60));
    console.log('SYNC COMPLETE');
    console.log('='.repeat(60));
    console.log(`✓ Linked existing: ${result.linked}`);
    console.log(`✓ Created new: ${result.created}`);
    console.log(`- Skipped: ${result.skipped}`);

    if (result.errors.length > 0) {
      console.log(`\n⚠ Errors (${result.errors.length}):`);
      result.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }

    console.log('\nDone!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Fatal error:', error);
    process.exit(1);
  }
}

main();
