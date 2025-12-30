import { db } from './server/db';
import { sql } from 'drizzle-orm';
import fs from 'fs';

async function applyMigration() {
  try {
    console.log('Reading migration file...');
    const migrationSQL = fs.readFileSync('./server/db/migrations/0012_add_order_state_timestamps.sql', 'utf8');
    
    console.log('Applying migration 0012: Add order state timestamps...');
    await db.execute(sql.raw(migrationSQL));
    
    console.log('✅ Migration 0012 applied successfully!');
    console.log('Added columns: started_production_at, completed_production_at, canceled_at, cancellation_reason');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
