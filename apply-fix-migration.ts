import "dotenv/config";
import { db } from "./server/db";
import { sql } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function main() {
  console.log("Applying manual migration: 0011_ensure_jobs_order_id.sql");
  
  const migrationPath = path.join(process.cwd(), "server", "db", "migrations", "0011_ensure_jobs_order_id.sql");
  const migrationSql = fs.readFileSync(migrationPath, "utf-8");

  try {
    await db.execute(sql.raw(migrationSql));
    console.log("Migration applied successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
  }

  process.exit(0);
}

main().catch(console.error);
