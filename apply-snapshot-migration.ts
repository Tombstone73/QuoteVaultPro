import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config();

const sql = neon(process.env.DATABASE_URL!);

async function applyMigration() {
  try {
    console.log('📦 Reading migration file...');
    const migrationPath = join(__dirname, 'server', 'db', 'migrations', '0014_add_quote_order_snapshots.sql');
    const migrationSql = readFileSync(migrationPath, 'utf-8');
    
    console.log('🔄 Applying migration 0014_add_quote_order_snapshots.sql...');
    await sql(migrationSql);
    
    console.log('✅ Migration applied successfully!');
    console.log('');
    console.log('📊 Verifying changes...');
    
    // Verify quotes table has new columns
    const quotesCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'quotes' 
      AND column_name IN ('status', 'billToName', 'shipToName', 'convertedToOrderId')
      ORDER BY column_name
    `;
    
    console.log(`Quotes table new columns: ${quotesCheck.map(r => r.column_name).join(', ')}`);
    
    // Verify orders table has new columns
    const ordersCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'orders' 
      AND column_name IN ('billToName', 'shipToName', 'trackingNumber', 'requestedDueDate')
      ORDER BY column_name
    `;
    
    console.log(`Orders table new columns: ${ordersCheck.map(r => r.column_name).join(', ')}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

applyMigration();
