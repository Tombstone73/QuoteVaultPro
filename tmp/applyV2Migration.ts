import "dotenv/config";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../server/db";

const LEDGER = "public.__drizzle_migrations_v2";
const LOCK_KEY = 928372001;

async function main() {
  const [migrationArg] = process.argv.slice(2);
  if (!migrationArg) {
    throw new Error("Usage: npx tsx tmp/applyV2Migration.ts <migration-path>");
  }

  const migrationPath = path.resolve(process.cwd(), migrationArg);
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file not found: ${migrationPath}`);
  }

  const content = fs.readFileSync(migrationPath, "utf8");
  const hash = createHash("sha256").update(content).digest("hex");

  console.log(`[applyV2Migration] file=${migrationPath}`);
  console.log(`[applyV2Migration] hash=${hash}`);

  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${LOCK_KEY})`);

    const existing = await client.query(
      `SELECT id, hash, created_at FROM ${LEDGER} WHERE hash = $1 LIMIT 1`,
      [hash],
    );

    if (existing.rows.length > 0) {
      console.log("[applyV2Migration] ledger already contains this hash; SQL apply skipped");
      console.log(JSON.stringify(existing.rows[0], null, 2));
      return;
    }

    console.log("[applyV2Migration] applying SQL...");
    await client.query(content);

    const createdAt = Date.now();
    await client.query(
      `INSERT INTO ${LEDGER} (hash, created_at) VALUES ($1, $2)`,
      [hash, createdAt],
    );

    const inserted = await client.query(
      `SELECT id, hash, created_at FROM ${LEDGER} WHERE hash = $1 LIMIT 1`,
      [hash],
    );

    console.log("[applyV2Migration] applied and recorded:");
    console.log(JSON.stringify(inserted.rows[0] ?? null, null, 2));

    const columns = await db.execute(sql.raw(`
      select column_name
      from information_schema.columns
      where table_name = 'quote_line_items'
        and column_name in ('requires_design', 'requires_prepress')
      order by column_name
    `));
    console.log("[applyV2Migration] quote_line_items routing columns:");
    console.log(JSON.stringify(columns.rows, null, 2));
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
    } finally {
      client.release();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});