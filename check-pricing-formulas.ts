import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function checkMigration() {
  try {
    // Check if pricing_formulas table exists
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'pricing_formulas'
    `);
    console.log('pricing_formulas table exists:', tables.rows.length > 0);

    // Check if pricing_formula_id column exists in products
    const cols = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'products' AND column_name = 'pricing_formula_id'
    `);
    console.log('products.pricing_formula_id column exists:', cols.rows.length > 0);

    // If table doesn't exist, need to run full migration
    if (tables.rows.length === 0) {
      console.log('\nRunning migration to create pricing_formulas table...');
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS pricing_formulas (
          id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id VARCHAR NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(100),
          description TEXT,
          pricing_profile_key VARCHAR(100) NOT NULL,
          expression TEXT,
          config JSONB,
          is_active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMP NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      console.log('  ✓ Created pricing_formulas table');
      
      await db.execute(sql`CREATE INDEX IF NOT EXISTS pricing_formulas_org_id_idx ON pricing_formulas(organization_id)`);
      console.log('  ✓ Created organization_id index');
      
      await db.execute(sql`CREATE INDEX IF NOT EXISTS pricing_formulas_code_org_idx ON pricing_formulas(organization_id, code)`);
      console.log('  ✓ Created code index');
    }

    // Add column to products if it doesn't exist
    if (cols.rows.length === 0) {
      console.log('\nAdding pricing_formula_id column to products...');
      await db.execute(sql`
        ALTER TABLE products ADD COLUMN pricing_formula_id VARCHAR REFERENCES pricing_formulas(id) ON DELETE SET NULL
      `);
      console.log('  ✓ Added pricing_formula_id column');
      
      await db.execute(sql`CREATE INDEX IF NOT EXISTS products_pricing_formula_id_idx ON products(pricing_formula_id)`);
      console.log('  ✓ Created index on pricing_formula_id');
    }

    console.log('\n✓ Migration check complete!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkMigration();
