/**
 * Apply SaaS Tax Migration
 * Run with: npx tsx apply-saas-tax-migration.ts
 */

import { readFileSync } from "fs";
import { db } from "./server/db";
import { sql } from "drizzle-orm";

async function applyMigration() {
  console.log("Applying SaaS Tax System Migration (0030)...");
  
  try {
    const migrationSQL = readFileSync("./migrations/0030_saas_tax_zones.sql", "utf8");
    
    // Execute the migration
    await db.execute(sql.raw(migrationSQL));
    
    console.log("✅ Migration 0030 applied successfully!");
    console.log("Added tables:");
    console.log("  - tax_zones");
    console.log("  - tax_categories");
    console.log("  - organization_tax_nexus");
    console.log("  - tax_rules");
    console.log("  - product_variants.tax_category_id");
    
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

applyMigration();
