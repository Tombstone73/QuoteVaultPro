import "dotenv/config";
import { pool } from "./server/db";
import fs from "fs";
import path from "path";

async function runMigration() {
  console.log("Starting manual migration...");
  
  const migrationPath = path.join(process.cwd(), "server", "db", "migrations", "0010_production_workflow_mvp.sql");
  
  try {
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
