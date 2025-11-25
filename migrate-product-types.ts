// Simple migration runner for product types
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const sql = neon(process.env.DATABASE_URL!);

async function runMigration() {
  try {
    console.log('Running product types migration...');
    const migrationSQL = fs.readFileSync('server/db/migrations/0012_add_product_types.sql', 'utf8');
    
    await sql(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    console.log('You can now:');
    console.log('1. Navigate to Admin → Settings → Products');
    console.log('2. Click "Manage Product Types"');
    console.log('3. View/edit the default product types');
    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Table already exists - you can skip this migration');
    }
    process.exit(1);
  }
}

runMigration();
