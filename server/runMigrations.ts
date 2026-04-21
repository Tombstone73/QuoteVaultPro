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

// ---------------------------------------------------------------------------
// Release verification checks
// ---------------------------------------------------------------------------
//
// Add an entry here for every schema object that application code depends on.
// Checks run after migrate() and block startup if any fail.
//
// Check types:
//   column_exists — column must be present on a table in public schema
//   table_exists  — table must exist in public schema
//   row_exists    — at least one row matching WHERE must exist (WHERE is in-file config, not user input)
//
// HOW TO USE FOR FUTURE RELEASES:
//   1. Write the migration SQL.
//   2. Add an entry below for the schema object your new code depends on.
//   3. Deploy to dev — confirm all checks log "Verify PASS".
//   4. Only after dev passes, merge to main.
//   5. Keep entries here permanently; they become regression guards on every boot.

type ReleaseCheck =
  | { type: "column_exists"; table: string; column: string; label: string }
  | { type: "table_exists"; table: string; label: string }
  | { type: "row_exists"; table: string; where: string; label: string };

const RELEASE_CHECKS: ReleaseCheck[] = [
  // migration 0032 — proof approval snapshot
  { type: "column_exists", table: "quote_line_items", column: "requires_proof_approval", label: "quote_line_items.requires_proof_approval" },
  // migration 0033 — DDL canary (proves DDL + DML execution reached this DB)
  { type: "table_exists", table: "_migrations_v2_canary", label: "_migrations_v2_canary table" },
  { type: "row_exists",   table: "_migrations_v2_canary", where: "id = 1", label: "_migrations_v2_canary row id=1" },
];

async function runReleaseChecks(client: any): Promise<void> {
  if (RELEASE_CHECKS.length === 0) return;
  console.log(`[Migrations] Running ${RELEASE_CHECKS.length} release verification check(s)...`);
  let failed = 0;

  for (const check of RELEASE_CHECKS) {
    try {
      let exists = false;

      if (check.type === "column_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
           ) AS ok`,
          [check.table, check.column],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "table_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = $1
           ) AS ok`,
          [check.table],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "row_exists") {
        // WHERE is developer-controlled in-file config — not user input.
        const safeName = check.table.replace(/[^a-z0-9_]/gi, "");
        const res = await client.query(
          `SELECT EXISTS (SELECT 1 FROM public."${safeName}" WHERE ${check.where}) AS ok`,
        );
        exists = res.rows[0].ok;
      }

      if (exists) {
        console.log(`[Migrations] Verify PASS: ${check.label}`);
      } else {
        console.error(`[Migrations] Verify FAIL: ${check.label}`);
        failed++;
      }
    } catch (e: any) {
      console.error(`[Migrations] Verify ERROR: ${check.label} — ${e?.message}`);
      failed++;
    }
  }

  if (failed > 0) {
    throw new Error(
      `${failed} release verification check(s) failed — server startup blocked. ` +
      `Fix the schema or update RELEASE_CHECKS in runMigrations.ts.`,
    );
  }
  console.log(`[Migrations] All ${RELEASE_CHECKS.length} release verification check(s) passed`);
}

// ---------------------------------------------------------------------------

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

  // Resolve migrations folder relative to this file's runtime location.
  //
  // How it resolves:
  //   dev  (tsx server/index.ts):    import.meta.url = file:///…/server/runMigrations.ts
  //                                  → dirname = …/server
  //                                  → folder  = …/server/db/migrations_v2
  //
  //   prod (esbuild → dist/index.js): import.meta.url = file:///app/dist/index.js
  //                                  → dirname = /app/dist
  //                                  → folder  = /app/dist/db/migrations_v2
  //                                  (copied by scripts/copy-migrations.mjs during npm run build)
  const thisFileDir = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.join(thisFileDir, "db", "migrations_v2");

  console.log(`[Migrations] import.meta.url = ${import.meta.url}`);
  console.log(`[Migrations] Resolved thisFileDir: ${thisFileDir}`);
  console.log(`[Migrations] Starting migrations_v2 — folder: ${migrationsFolder}`);

  const folderExists = fs.existsSync(migrationsFolder);
  console.log(`[Migrations] Folder exists: ${folderExists}`);
  if (!folderExists) {
    // Fail fast — migrate() silently applies nothing against a missing folder,
    // which would mask the problem in deploy logs and leave the DB at the wrong schema.
    console.error(`[Migrations] ERROR: migrations folder not found at resolved path: ${migrationsFolder}`);
    console.error(`[Migrations] Expected: <dist_root>/db/migrations_v2 — verify scripts/copy-migrations.mjs ran during build`);
    throw new Error(`Migrations folder not found: ${migrationsFolder}`);
  }
  const files = fs.readdirSync(migrationsFolder).sort();
  console.log(`[Migrations] Folder contents (${files.length}): ${files.join(", ")}`);

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

    // Run all release verification checks. Throws if any fail → caught below → startup blocked.
    await runReleaseChecks(client);

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
