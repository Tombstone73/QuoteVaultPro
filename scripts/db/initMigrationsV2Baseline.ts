import "dotenv/config";

import { sql } from "drizzle-orm";
import { db } from "../../server/db";

const LEDGER = "public.__drizzle_migrations_v2";
const BASELINE_TAG = "0000_baseline";
const LOCK_KEY = 902581104;

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is missing");
  }

  console.log(`[db:migrations:v2:init-baseline] Ensuring ${LEDGER} exists...`);

  await db.execute(sql`SELECT pg_advisory_lock(${LOCK_KEY})`);

  try {
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ${LEDGER} (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      )
    `));

    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS drizzle_migrations_v2_hash_uidx
      ON ${LEDGER} (hash)
    `));

    await db.execute(sql.raw(`
      INSERT INTO ${LEDGER} (hash, created_at)
      VALUES ('${BASELINE_TAG}', (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT)
      ON CONFLICT (hash) DO NOTHING
    `));

    const result = await db.execute(sql.raw(`
      SELECT id, hash, created_at
      FROM ${LEDGER}
      ORDER BY created_at ASC, id ASC
    `));

    console.log(`[db:migrations:v2:init-baseline] Ledger rows: ${result.rows.length}`);
    for (const row of result.rows as Array<{ id?: number; hash?: string; created_at?: number }>) {
      console.log(`  - id=${row.id ?? "?"} hash=${row.hash ?? "?"} created_at=${row.created_at ?? "?"}`);
    }

    const baselineExists = result.rows.some((r: any) => r?.hash === BASELINE_TAG);
    if (!baselineExists) {
      throw new Error(`Baseline tag '${BASELINE_TAG}' was not found after initialization`);
    }

    console.log(`[db:migrations:v2:init-baseline] Baseline initialized successfully.`);
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
  }
}

main().catch((error) => {
  console.error("[db:migrations:v2:init-baseline] Failed:", error);
  process.exit(1);
});
