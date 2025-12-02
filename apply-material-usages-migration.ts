// Apply material usages migration
import { sql } from 'drizzle-orm';
import { db } from './server/db';
import * as fs from 'fs';
import * as path from 'path';

async function applyMigration() {
  try {
    console.log('Applying migration: 0024_material_usages_tracking.sql');
    
    // Add materialUsages to quote_line_items
    await db.execute(sql`
      ALTER TABLE quote_line_items 
      ADD COLUMN IF NOT EXISTS material_usages JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    console.log('✓ Added material_usages to quote_line_items');
    
    // Add materialUsages to order_line_items  
    await db.execute(sql`
      ALTER TABLE order_line_items 
      ADD COLUMN IF NOT EXISTS material_usages JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    console.log('✓ Added material_usages to order_line_items');
    
    // Add indexes
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS quote_line_items_material_usages_idx 
      ON quote_line_items USING GIN (material_usages)
    `);
    console.log('✓ Created index on quote_line_items.material_usages');
    
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS order_line_items_material_usages_idx 
      ON order_line_items USING GIN (material_usages)
    `);
    console.log('✓ Created index on order_line_items.material_usages');
    
    console.log('✅ Migration applied successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
