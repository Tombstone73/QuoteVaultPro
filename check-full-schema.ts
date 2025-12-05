import { db } from './server/db';
import { sql } from 'drizzle-orm';

async function checkSchema() {
  try {
    console.log('🔍 All quotes table columns:');
    const allQuotesColumns = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'quotes'
      ORDER BY ordinal_position
    `);
    
    console.log(allQuotesColumns.rows.map(r => r.column_name).join(', '));
    
    console.log('\n🔍 All orders table columns:');
    const allOrdersColumns = await db.execute(sql`
      SELECT column_name, data_type
      FROM information_schema.columns 
      WHERE table_name = 'orders'
      ORDER BY ordinal_position
    `);
    
    console.log(allOrdersColumns.rows.map(r => r.column_name).join(', '));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed:', error);
    process.exit(1);
  }
}

checkSchema();
