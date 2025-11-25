import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

async function applyFulfillmentMigration() {
  try {
    console.log('Applying fulfillment migration...');
    
    const migrationPath = path.join(process.cwd(), 'migrations', '0007_shipping_fulfillment.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await db.execute(sql.raw(migrationSQL));
    
    console.log('✅ Fulfillment migration applied successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyFulfillmentMigration();
