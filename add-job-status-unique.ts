import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Adding unique constraint to job_statuses.key...');
  try {
    await db.execute(sql`ALTER TABLE job_statuses ADD CONSTRAINT job_statuses_key_unique UNIQUE (key)`);
    console.log('✓ Unique constraint added successfully');
  } catch (err: any) {
    if (err.code === '42710') {
      console.log('✓ Unique constraint already exists');
    } else {
      console.error('Error:', err.message);
      throw err;
    }
  }
  process.exit(0);
}

main();
