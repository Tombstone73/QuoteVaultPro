import 'dotenv/config';
import { db } from './server/db';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

async function applyInvoicingMigration() {
  try {
    console.log('Applying invoicing migration...');
    
    const migrationPath = path.join(process.cwd(), 'migrations', '0006_invoicing.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
    
    await db.execute(sql.raw(migrationSQL));
    
    console.log('✅ Invoicing migration applied successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyInvoicingMigration();
