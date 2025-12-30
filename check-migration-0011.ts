import "dotenv/config";
import { db, pool } from "./server/db";
import { sql } from "drizzle-orm";

async function checkColumns() {
  try {
    console.log("[Check] Checking if migration 0011 columns exist...");
    
    const result = await db.execute(sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'order_attachments' 
        AND column_name IN ('thumb_key', 'preview_key', 'thumb_status', 'thumb_error')
      ORDER BY column_name
    `);
    
    console.log("\n[Check] Columns found in order_attachments:");
    if (result.rows.length === 0) {
      console.log("  ❌ NONE - Migration 0011 needs to be applied");
    } else {
      result.rows.forEach((row: any) => {
        console.log(`  ✅ ${row.column_name}`);
      });
      
      if (result.rows.length === 4) {
        console.log("\n[Check] ✅ All migration 0011 columns exist - migration already applied");
      } else {
        console.log(`\n[Check] ⚠️  Only ${result.rows.length}/4 columns exist - migration may be incomplete`);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error("[Check] ❌ Error:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkColumns();
