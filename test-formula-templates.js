import { drizzle } from "drizzle-orm/node-postgres";
import pkg from "pg";
const { Pool } = pkg;
import { formulaTemplates } from "./shared/schema.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function checkFormulaTemplates() {
  try {
    console.log("Fetching all formula templates...");
    const templates = await db.select().from(formulaTemplates);
    console.log(`Found ${templates.length} formula templates:`);
    console.log(JSON.stringify(templates, null, 2));
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await pool.end();
  }
}

checkFormulaTemplates();

