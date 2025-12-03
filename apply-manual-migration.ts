import "dotenv/config";
import { pool } from "./server/db";
import fs from "fs";
import path from "path";

async function runMigration() {
  console.log("Starting manual migration...");
  
  // Get migration file from command line argument
  const migrationFile = process.argv[2];
  if (!migrationFile) {
    console.error("Usage: npx tsx apply-manual-migration.ts <migration-file>");
    console.error("Example: npx tsx apply-manual-migration.ts migrations/0028_customer_pricing_modifiers.sql");
    process.exit(1);
  }

  const migrationPath = path.join(process.cwd(), migrationFile);
  
  try {
    if (!fs.existsSync(migrationPath)) {
      console.error(`Migration file not found: ${migrationPath}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(migrationPath, "utf-8");
    console.log(`Read migration file from ${migrationPath}`);
    
    // Execute the SQL
    await pool.query(sql);
    
    console.log("Migration executed successfully!");
  } catch (error) {
    console.error("Error executing migration:", error);
  } finally {
    await pool.end();
  }
}

runMigration();
