import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
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
 *   dev  (tsx server/index.ts):  import.meta.url → server/runMigrations.ts → db/migrations_v2
 *   prod (dist/index.js bundle): import.meta.url → dist/index.js           → dist/db/migrations_v2
 *                                (copied by scripts/copy-migrations.mjs during `npm run build`)
 */
export async function runMigrations(): Promise<void> {
  console.log("[Migrations] runMigrations() entered");

  // --- TEMP DIAGNOSTIC: redacted DATABASE_URL ---
  try {
    const dbUrl = process.env.DATABASE_URL || "";
    if (dbUrl) {
      const u = new URL(dbUrl);
      console.log(`[Migrations] DATABASE_URL → host=${u.hostname} db=${u.pathname.slice(1)} (redacted)`);
    } else {
      console.log("[Migrations] DATABASE_URL is EMPTY or UNSET");
    }
  } catch { console.log("[Migrations] DATABASE_URL could not be parsed"); }

  const flagVal = (process.env.DRIZZLE_AUTO_MIGRATE ?? "").trim().toLowerCase();
  console.log(`[Migrations] DRIZZLE_AUTO_MIGRATE raw=${JSON.stringify(process.env.DRIZZLE_AUTO_MIGRATE)} parsed=${JSON.stringify(flagVal)}`);
  if (flagVal === "0" || flagVal === "false") {
    console.log("[Migrations] DRIZZLE_AUTO_MIGRATE=disabled — skipping auto-migration");
    return;
  }

  // Resolve migrations folder relative to this file so it works both in dev
  // (tsx resolves to server/) and in production (esbuild bundle resolves to dist/).
  const migrationsFolder = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "db",
    "migrations_v2"
  );

  console.log(`[Migrations] import.meta.url = ${import.meta.url}`);
  console.log(`[Migrations] Starting migrations_v2 — folder: ${migrationsFolder}`);

  // --- TEMP DIAGNOSTIC: check folder existence and contents ---
  const folderExists = fs.existsSync(migrationsFolder);
  console.log(`[Migrations] Folder exists: ${folderExists}`);
  if (folderExists) {
    const files = fs.readdirSync(migrationsFolder).sort();
    console.log(`[Migrations] Folder contents (${files.length}): ${files.join(", ")}`);
  }

  // Acquire a session-level advisory lock on a dedicated connection so that
  // concurrent server instances do not run migrations simultaneously.
  // The lock is automatically released when the connection is returned to the pool.
  const client = await (pool as any).connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
    console.log("[Migrations] Advisory lock acquired");

    // --- PRE-MIGRATION DIAGNOSTICS ---
    // Log the database identity so we can confirm Railway is hitting the right DB.
    try {
      const identityRes = await client.query(
        `SELECT current_database() AS db, current_user AS usr, inet_server_addr() AS addr`
      );
      const id = identityRes.rows[0] ?? {};
      console.log(`[Migrations] DB identity: db=${id.db}, user=${id.usr}, addr=${id.addr ?? 'null'}`);
    } catch (e: any) {
      console.warn("[Migrations] DB identity query failed:", e?.message);
    }

    // Highest ledger id before migrate — -1 means table doesn't exist yet (fresh DB).
    try {
      const preRes = await client.query(
        `SELECT COALESCE(MAX(id), -1) AS max_id FROM public.${MIGRATIONS_TABLE}`
      );
      console.log(`[Migrations] Ledger max_id before migrate: ${preRes.rows[0].max_id}`);
    } catch (e: any) {
      console.log(`[Migrations] Ledger max_id before migrate: table not yet created (fresh database)`);
    }

    console.log("[Migrations] Calling drizzle migrate() now...");
    await migrate(db, {
      migrationsFolder,
      migrationsTable: MIGRATIONS_TABLE,
      migrationsSchema: MIGRATIONS_SCHEMA,
    });
    console.log("[Migrations] Migrations_v2 complete — migrate() returned without error");

    // Highest ledger id after migrate.
    try {
      const postRes = await client.query(
        `SELECT COALESCE(MAX(id), -1) AS max_id FROM public.${MIGRATIONS_TABLE}`
      );
      console.log(`[Migrations] Ledger max_id after migrate: ${postRes.rows[0].max_id}`);
    } catch (e: any) {
      console.warn("[Migrations] Ledger max_id post-check failed:", e?.message);
    }

    // Canary check: migration 0033 creates _migrations_v2_canary with a sentinel row.
    // If this table exists, DDL + DML reached this DB and all prior migrations ran.
    try {
      const canaryRes = await client.query(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_name = '_migrations_v2_canary'
         ) AS has_canary`
      );
      console.log(`[Migrations] _migrations_v2_canary exists: ${canaryRes.rows[0].has_canary}`);
    } catch (e: any) {
      console.warn("[Migrations] Canary post-check failed:", e?.message);
    }

  } catch (err: any) {
    console.error("[Migrations] Migrations_v2 failed — error message:", err?.message);
    console.error("[Migrations] FAILED — stack:", err?.stack);
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
