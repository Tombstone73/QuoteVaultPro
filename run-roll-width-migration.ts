import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function runMigration() {
  try {
    console.log('Running roll width tracking migration...');
    const migrationSQL = fs.readFileSync('migrations/0031_roll_width_tracking.sql', 'utf8');
    
    // Split by semicolons but handle DO $$ blocks properly
    const statements: string[] = [];
    let currentStatement = '';
    let inDoBlock = false;
    
    for (const line of migrationSQL.split('\n')) {
      const trimmed = line.trim();
      
      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('--')) {
        continue;
      }
      
      currentStatement += line + '\n';
      
      if (trimmed.startsWith('DO $$')) {
        inDoBlock = true;
      }
      
      if (inDoBlock && trimmed === 'END $$;') {
        inDoBlock = false;
        statements.push(currentStatement.trim());
        currentStatement = '';
      } else if (!inDoBlock && trimmed.endsWith(';')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }
    
    for (const statement of statements) {
      if (statement.length > 0) {
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
