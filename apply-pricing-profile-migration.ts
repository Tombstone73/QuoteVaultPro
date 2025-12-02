import { db } from './server/db.js';
import { sql } from 'drizzle-orm';

async function runPricingProfileMigration() {
  try {
    console.log('Running pricing profile migration...');
    
    // Add pricing_profile_key column
    console.log('Adding pricing_profile_key column...');
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_profile_key') THEN
          ALTER TABLE products ADD COLUMN pricing_profile_key VARCHAR(100) DEFAULT 'default';
        END IF;
      END $$
    `);
    
    // Add pricing_profile_config JSONB column
    console.log('Adding pricing_profile_config column...');
    await db.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'pricing_profile_config') THEN
          ALTER TABLE products ADD COLUMN pricing_profile_config JSONB;
        END IF;
      END $$
    `);
    
    // Migrate existing products with nesting calculator to flat_goods profile
    console.log('Migrating existing nesting products to flat_goods profile...');
    await db.execute(sql`
      UPDATE products 
      SET pricing_profile_key = 'flat_goods',
          pricing_profile_config = jsonb_build_object(
            'sheetWidth', COALESCE(sheet_width::numeric, 48),
            'sheetHeight', COALESCE(sheet_height::numeric, 96),
            'allowRotation', true,
            'materialType', COALESCE(material_type, 'sheet'),
            'minPricePerItem', min_price_per_item::numeric
          )
      WHERE use_nesting_calculator = true 
        AND (pricing_profile_key IS NULL OR pricing_profile_key = 'default')
    `);
    
    // Migrate service/fee products to fee profile
    console.log('Migrating service products to fee profile...');
    await db.execute(sql`
      UPDATE products 
      SET pricing_profile_key = 'fee'
      WHERE is_service = true 
        AND (pricing_profile_key IS NULL OR pricing_profile_key = 'default')
    `);
    
    // Migrate quantity-only products to qty_only profile
    console.log('Migrating quantity-only products to qty_only profile...');
    await db.execute(sql`
      UPDATE products 
      SET pricing_profile_key = 'qty_only'
      WHERE pricing_mode = 'quantity' 
        AND is_service = false
        AND (pricing_profile_key IS NULL OR pricing_profile_key = 'default')
    `);
    
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runPricingProfileMigration();
