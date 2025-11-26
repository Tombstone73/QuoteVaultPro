// Run the artwork & file handling migration
const { Pool } = require('pg');
const { readFileSync } = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  const sql = readFileSync('./migrations/0011_artwork_file_handling.sql', 'utf-8');
  
  try {
    await pool.query(sql);
    console.log('✅ Migration 0011_artwork_file_handling.sql applied successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
