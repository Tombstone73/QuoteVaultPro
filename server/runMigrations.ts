import { fileURLToPath } from "url";
import path from "path";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { db, pool } from "./db";

/**
 * Stable advisory lock key for migration mutual exclusion.
 * Any constant integer works; unique to this application to avoid collisions.
 */
const ADVISORY_LOCK_KEY = 928372001;
const MIGRATIONS_TABLE = "__drizzle_migrations_v2";
const MIGRATIONS_SCHEMA = "public";

/**
 * Run Drizzle migrations at server startup.
 *
 * Kill switch: set DRIZZLE_AUTO_MIGRATE=0 or DRIZZLE_AUTO_MIGRATE=false to skip.
 *
 * Advisory lock: uses pg_advisory_lock so that concurrent instances
 * (e.g. rolling deploy with two pods) do not race on migrations.
 *
 * Manual smoke checks:
 *   1. DRIZZLE_AUTO_MIGRATE=1  → logs "[Migrations] Complete"
 *   2. Run again immediately   → logs "[Migrations] Complete" quickly (Drizzle is idempotent)
 *   3. DRIZZLE_AUTO_MIGRATE=0  → logs "[Migrations] skipped"
 *
 * Migrations folder resolution:
 *   dev  (tsx server/index.ts):  import.meta.url → server/runMigrations.ts → db/migrations
 *   prod (dist/index.js bundle): import.meta.url → dist/index.js           → dist/db/migrations
 *                                (copied by scripts/copy-migrations.mjs during `npm run build`)
 */
export async function runMigrations(): Promise<void> {
  const flagVal = (process.env.DRIZZLE_AUTO_MIGRATE ?? "").trim().toLowerCase();
  if (flagVal === "0" || flagVal === "false") {
    console.log("[Migrations] DRIZZLE_AUTO_MIGRATE=disabled — skipping auto-migration");
    return;
  }

  // Resolve migrations folder relative to this file so it works both in dev
  // (tsx resolves to server/) and in production (esbuild bundle resolves to dist/).
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "db",
    "migrations"
  );

  console.log(`[Migrations] Starting — folder: ${migrationsFolder}`);

  // Acquire a session-level advisory lock on a dedicated connection so that
  // concurrent server instances do not run migrations simultaneously.
  // The lock is automatically released when the connection is returned to the pool.
  const client = await (pool as any).connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
    console.log("[Migrations] Advisory lock acquired");

    await migrate(db, {
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });

    console.log("[Migrations] Complete");
  } catch (err) {
    console.error("[Migrations] Failed:", err);
    // Fail fast — do not start the server with a potentially partial schema.
    throw err;
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
    } catch {
      // Ignore release errors; the lock is released when the connection closes anyway.
    }
    client.release();
  }
}
