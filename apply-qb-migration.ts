import pg from 'pg';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function applyMigration() {
  try {
    const sql = readFileSync(join(__dirname, 'server/db/migrations/0010_quickbooks_integration.sql'), 'utf-8');
    console.log('[Migration] Applying QuickBooks integration migration...');
    await pool.query(sql);
    console.log('[Migration] ✓ QuickBooks integration migration applied successfully');
  } catch (error: any) {
    console.error('[Migration] ✗ Failed to apply migration:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

applyMigration();
