import "dotenv/config";
import { db, pool } from "./server/db";
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function applyMigration() {
  try {
    console.log("[Migration] Applying 0010_add_order_list_notes.sql...");
    
    const migrationPath = join(__dirname, "server", "db", "migrations", "0010_add_order_list_notes.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    
    await db.execute(migrationSQL);
    
    console.log("[Migration] ✅ Successfully applied migration 0010");
    console.log("[Migration] order_list_notes table created");
    
    process.exit(0);
  } catch (error) {
    console.error("[Migration] ❌ Failed to apply migration:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
