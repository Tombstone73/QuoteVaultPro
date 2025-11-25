import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function runMigration() {
  try {
    console.log('Running product types migration...');
    const migrationSQL = fs.readFileSync('server/db/migrations/0012_add_product_types.sql', 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    for (const statement of statements) {
      if (statement.includes('CREATE') || statement.includes('INSERT') || statement.includes('ALTER') || statement.includes('DO $$')) {
        console.log('Executing:', statement.substring(0, 80) + '...');
        await db.execute(sql.raw(statement));
      }
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
