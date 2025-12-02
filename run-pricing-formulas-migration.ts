import { db } from './server/db.js';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';

async function runPricingFormulasMigration() {
  try {
    console.log('Running pricing formulas migration...');
    const migrationSQL = fs.readFileSync('migrations/0025_pricing_formulas.sql', 'utf8');
    
    // Split by semicolons, but handle DO $$ ... $$ blocks specially
    const doBlockMatch = migrationSQL.match(/DO \$\$[\s\S]*?\$\$;/g);
    const restOfSQL = migrationSQL.replace(/DO \$\$[\s\S]*?\$\$;/g, '').split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    // Execute regular statements first
    for (const statement of restOfSQL) {
      if (statement.includes('CREATE') || statement.includes('INSERT') || statement.includes('ALTER') || statement.includes('COMMENT')) {
        console.log('Executing:', statement.substring(0, 80) + '...');
        try {
          await db.execute(sql.raw(statement));
          console.log('  ✓ Success');
        } catch (e: any) {
          if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
            console.log('  ⚠ Already exists, skipping');
          } else {
            throw e;
          }
        }
      }
    }

    // Execute DO blocks
    if (doBlockMatch) {
      for (const doBlock of doBlockMatch) {
        console.log('Executing DO block:', doBlock.substring(0, 80) + '...');
        try {
          await db.execute(sql.raw(doBlock));
          console.log('  ✓ Success');
        } catch (e: any) {
          if (e.message?.includes('already exists') || e.message?.includes('duplicate')) {
            console.log('  ⚠ Already exists, skipping');
          } else {
            throw e;
          }
        }
      }
    }
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runPricingFormulasMigration();
