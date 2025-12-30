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
    console.log("[Migration] Applying 0011_add_order_attachments_thumbnail_columns.sql...");
    
    const migrationPath = join(__dirname, "server", "db", "migrations", "0011_add_order_attachments_thumbnail_columns.sql");
    const migrationSQL = readFileSync(migrationPath, "utf-8");
    
    await db.execute(migrationSQL);
    
    console.log("[Migration] ✅ Successfully applied migration 0011");
    console.log("[Migration] order_attachments now has: thumb_key, preview_key, thumb_status, thumb_error columns");
    
    process.exit(0);
  } catch (error) {
    console.error("[Migration] ❌ Failed to apply migration:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

applyMigration();
