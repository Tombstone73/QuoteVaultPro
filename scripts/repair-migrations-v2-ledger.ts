/**
 * ONE-OFF SCRIPT — repair public.__drizzle_migrations_v2 ledger
 *
 * Context: migrations 0003 and 0004 were applied to the database manually via
 * apply-manual-migration.ts (which bypasses Drizzle's hash-tracking). The schema
 * changes are already in place. This script only repairs the tracking table so
 * that future drizzle migrate() calls do not attempt to re-run those files.
 *
 * Safe to run multiple times — uses INSERT … WHERE NOT EXISTS (idempotent).
 * Does NOT run or modify any schema SQL.
 * Does NOT modify any migration SQL files or the journal JSON.
 *
 * Usage:
 *   npx tsx scripts/repair-migrations-v2-ledger.ts
 *
 * With a custom DATABASE_URL:
 *   DATABASE_URL=postgresql://... npx tsx scripts/repair-migrations-v2-ledger.ts
 */

import "dotenv/config";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const MIGRATIONS_TABLE = "public.__drizzle_migrations_v2";

const MIGRATIONS_V2_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "server",
  "db",
  "migrations_v2"
);

const FILES_TO_REPAIR = [
  "0003_active_job_uniqueness.sql",
  "0004_line_item_status_cleanup.sql",
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("[repair] ERROR: DATABASE_URL is not set.");
    process.exit(1);
  }

  // Redacted connection info for logging only
  try {
    const u = new URL(connectionString);
    console.log(`[repair] Connecting to host=${u.hostname} db=${u.pathname.slice(1)}`);
  } catch {
    console.log("[repair] Connecting to DATABASE_URL (could not parse for display)");
  }

  const pool = new Pool({ connectionString });

  try {
    // 1. Determine the current max id in the ledger table so we can assign
    //    sequential ids for inserted rows.
    const { rows: maxRows } = await pool.query<{ max_id: string | null }>(
      `SELECT MAX(id) AS max_id FROM ${MIGRATIONS_TABLE}`
    );
    let nextId = (parseInt(maxRows[0]?.max_id ?? "0", 10) || 0) + 1;
    console.log(`[repair] Current max id in ${MIGRATIONS_TABLE}: ${nextId - 1}. Next available: ${nextId}`);

    for (const filename of FILES_TO_REPAIR) {
      console.log(`\n[repair] ── ${filename} ──`);

      const filePath = path.join(MIGRATIONS_V2_DIR, filename);
      if (!fs.existsSync(filePath)) {
        console.error(`[repair] ERROR: file not found: ${filePath}`);
        process.exit(1);
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const hash = createHash("sha256").update(content).digest("hex");
      console.log(`[repair] Computed SHA-256: ${hash}`);

      // 2. Check whether a row with this hash already exists.
      const { rows: existing } = await pool.query<{ id: number }>(
        `SELECT id FROM ${MIGRATIONS_TABLE} WHERE hash = $1`,
        [hash]
      );

      if (existing.length > 0) {
        console.log(`[repair] Row already exists (id=${existing[0].id}) — skipping insert.`);
        continue;
      }

      // 3. Insert missing row.
      const createdAt = BigInt(Date.now()); // epoch milliseconds as bigint
      await pool.query(
        `INSERT INTO ${MIGRATIONS_TABLE} (id, hash, created_at) VALUES ($1, $2, $3)`,
        [nextId, hash, createdAt]
      );
      console.log(`[repair] Inserted row — id=${nextId}, created_at=${createdAt}.`);
      nextId++;
    }

    console.log(`\n[repair] Done. Run: SELECT id, hash, created_at FROM ${MIGRATIONS_TABLE} ORDER BY id; to verify.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[repair] Unhandled error:", err);
  process.exit(1);
});
