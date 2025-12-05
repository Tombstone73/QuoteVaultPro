import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function verifyMigration() {
  try {
    console.log('🔍 Verifying quotes table columns...');
    const quotesColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'quotes' 
      AND column_name IN ('status', 'billToName', 'billToCompany', 'shipToName', 'shippingMethod', 'convertedToOrderId', 'requestedDueDate', 'validUntil')
      ORDER BY column_name
    `);
    
    console.log('\n✅ Quotes table new columns:');
    quotesColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });
    
    console.log('\n🔍 Verifying orders table columns...');
    const ordersColumns = await db.execute(sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'orders' 
      AND column_name IN ('billToName', 'billToCompany', 'shipToName', 'shippingMethod', 'trackingNumber', 'shippedAt', 'requestedDueDate', 'productionDueDate')
      ORDER BY column_name
    `);
    
    console.log('\n✅ Orders table new columns:');
    ordersColumns.rows.forEach(col => {
      console.log(`  - ${col.column_name} (${col.data_type}, nullable: ${col.is_nullable})`);
    });
    
    console.log('\n✨ Migration verification complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

verifyMigration();
