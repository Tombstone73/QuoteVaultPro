import "dotenv/config";
import { pool } from "./server/db";
import fs from "fs";
import path from "path";

async function run0013Migration() {
  console.log("Applying 0013_asset_pipeline.sql migration...");
  
  const migrationPath = path.join(process.cwd(), "server/db/migrations/0013_asset_pipeline.sql");
  
  try {
    if (!fs.existsSync(migrationPath)) {
      console.error(`Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(migrationPath, "utf-8");
    console.log(`Read migration file from ${migrationPath}`);
    console.log(`SQL length: ${sql.length} characters`);
    
    // Execute the SQL
    await pool.query(sql);
    
    console.log("✓ Migration 0013_asset_pipeline.sql executed successfully!");
    console.log("✓ Created tables: assets, asset_variants, asset_links");
    console.log("✓ Created enums for status, variant kinds, link types");
    console.log("✓ Added indexes for multi-tenant filtering and performance");
  } catch (error) {
    console.error("✗ Error executing migration:", error);
    process.exit(1);
  } finally {
    await pool.end();
    console.log("Database connection closed");
  }
}

run0013Migration();
