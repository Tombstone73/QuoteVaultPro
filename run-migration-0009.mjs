import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config();

const runMigration = async () => {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const sql = readFileSync(
      join(__dirname, 'server', 'db', 'migrations', '0009_quote_list_notes_and_settings.sql'),
      'utf-8'
    );

    console.log('Running migration 0009...');
    await client.query(sql);
    console.log('✅ Migration 0009 completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
};

runMigration().catch((err) => {
  console.error(err);
  process.exit(1);
});
