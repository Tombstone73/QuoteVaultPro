#!/usr/bin/env tsx
/**
 * Apply TitanOS Phase 1 Migration (0012_order_state_architecture.sql)
 * 
 * This script applies the migration to add the state column and related
 * TitanOS State Architecture to the orders table.
 */

import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { readFileSync } from "fs";
import { resolve } from "path";
import ws from "ws";

// Configure Neon to use WebSocket in Node
neonConfig.webSocketConstructor = ws;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error("❌ DATABASE_URL not found in environment");
  process.exit(1);
}

async function main() {
  console.log("🔧 Applying TitanOS Phase 1 Migration (0012_order_state_architecture.sql)");
  console.log("");

  // Redact password for logging
  try {
    const url = new URL(connectionString!);
    const dbName = url.pathname.replace(/^\//, '') || 'unknown';
    const host = url.hostname || 'unknown';
    console.log(`📊 Target database: postgresql://${url.username}@${host}/${dbName}`);
  } catch (e) {
    console.log(`📊 Target database: (unable to parse URL)`);
  }
  console.log("");

  const pool = new Pool({ connectionString });

  try {
    // Read migration file
    const migrationPath = resolve(process.cwd(), "server/db/migrations/0012_order_state_architecture.sql");
    console.log(`📄 Reading migration file: ${migrationPath}`);
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    console.log(`✓ Migration file loaded (${migrationSQL.length} bytes)`);
    console.log("");

    // Check current state
    console.log("🔍 Checking current schema state...");
    const checkResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('state', 'status_pill_value', 'payment_status', 'routing_target')
      ORDER BY column_name
    `);
    const existingColumns = checkResult.rows.map((r: any) => r.column_name);
    console.log(`📋 Existing TitanOS columns: ${existingColumns.length > 0 ? existingColumns.join(', ') : 'NONE'}`);
    console.log("");

    if (existingColumns.includes('state')) {
      console.log("⚠️  Column 'orders.state' already exists - migration may have been applied");
      console.log("⚠️  Continuing anyway (migration uses IF NOT EXISTS for safety)");
      console.log("");
    }

    // Apply migration
    console.log("⚡ Applying migration...");
    await pool.query(migrationSQL);
    console.log("✅ Migration applied successfully!");
    console.log("");

    // Verify
    console.log("🔍 Verifying schema after migration...");
    const verifyResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name IN ('state', 'status_pill_value', 'payment_status', 'routing_target')
      ORDER BY column_name
    `);
    const verifiedColumns = verifyResult.rows.map((r: any) => r.column_name);
    console.log(`✓ TitanOS columns present: ${verifiedColumns.join(', ')}`);
    console.log("");

    // Check order_status_pills table
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'order_status_pills'
      ) as exists
    `);
    const tableExists = tableCheck.rows[0]?.exists;
    console.log(`✓ Table 'order_status_pills' exists: ${tableExists}`);
    console.log("");

    // Count default pills seeded
    if (tableExists) {
      const pillCount = await pool.query(`
        SELECT COUNT(*) as count FROM order_status_pills WHERE is_default = true
      `);
      console.log(`✓ Default status pills seeded: ${pillCount.rows[0]?.count || 0}`);
      console.log("");
    }

    console.log("🎉 Migration completed successfully!");
    console.log("✅ You can now restart the server - /api/orders should work");

  } catch (error: any) {
    console.error("❌ Migration failed:");
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
