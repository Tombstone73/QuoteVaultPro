/**
 * Apply roll material fields migration to the materials table
 * Run with: npx tsx apply-roll-material-migration.ts
 */
import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function main() {
  console.log('Applying roll material fields migration...');
  
  try {
    // Add roll_length_ft column
    await db.execute(sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS roll_length_ft DECIMAL(10, 2)`);
    console.log('✓ Added roll_length_ft column');
    
    // Add cost_per_roll column
    await db.execute(sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS cost_per_roll DECIMAL(10, 4)`);
    console.log('✓ Added cost_per_roll column');
    
    // Add edge_waste_in_per_side column
    await db.execute(sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS edge_waste_in_per_side DECIMAL(10, 2)`);
    console.log('✓ Added edge_waste_in_per_side column');
    
    // Add lead_waste_ft column with default
    await db.execute(sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS lead_waste_ft DECIMAL(10, 2) DEFAULT 0`);
    console.log('✓ Added lead_waste_ft column');
    
    // Add tail_waste_ft column with default
    await db.execute(sql`ALTER TABLE materials ADD COLUMN IF NOT EXISTS tail_waste_ft DECIMAL(10, 2) DEFAULT 0`);
    console.log('✓ Added tail_waste_ft column');
    
    console.log('\n✅ Migration complete! All roll material columns added.');
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

main();
