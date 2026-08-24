import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";
import { db, pool } from "./db";
import * as schema from "@shared/schema";
import {
  getMigrationLockConfig,
  getSafeDatabaseLabel,
  isPooledNeonDatabaseUrl,
  parseAutoMigrateConfig,
  selectMigrationDatabaseUrl,
} from "./lib/migrationRuntimeConfig";

/**
 * Stable advisory lock key for migration mutual exclusion.
 * Any constant integer works; unique to this application to avoid collisions.
 */
const ADVISORY_LOCK_KEY = 928372001;
const MIGRATIONS_TABLE = "__drizzle_migrations_v2";
const MIGRATIONS_SCHEMA = "public";

type MigrationRuntime = {
  pool: Pool;
  db: any;
  close: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createMigrationRuntime(): Promise<MigrationRuntime> {
  const selection = selectMigrationDatabaseUrl();
  if (!selection.connectionString) {
    throw new Error("DATABASE_URL must be set before running migrations.");
  }

  const safeLabel = getSafeDatabaseLabel(selection.connectionString);
  if (selection.usesAppDatabaseUrl) {
    console.log(`[Migrations] Using ${selection.source} for migrations: ${safeLabel}`);
  } else {
    console.log(`[Migrations] Using ${selection.source} for migrations instead of app DATABASE_URL: ${safeLabel}`);
  }

  if (isPooledNeonDatabaseUrl(selection.connectionString)) {
    console.warn(
      "[Migrations] Migration runner is using a pooled database connection. " +
      "Prefer a direct database URL for migrations to avoid stale session-level advisory locks.",
    );
  }

  if (selection.usesAppDatabaseUrl) {
    return {
      pool: pool as unknown as Pool,
      db,
      close: async () => {},
    };
  }

  const migrationPool = new Pool({ connectionString: selection.connectionString });
  const migrationDb = drizzle({ client: migrationPool, schema });
  return {
    pool: migrationPool,
    db: migrationDb,
    close: async () => {
      await migrationPool.end();
    },
  };
}

async function logAdvisoryLockDiagnostics(client: any): Promise<void> {
  try {
    const result = await client.query(
      `
        SELECT
          a.pid,
          a.application_name,
          a.client_addr::text AS client_addr,
          a.state,
          a.wait_event_type,
          a.wait_event,
          l.granted,
          now() - a.state_change AS state_age
        FROM pg_locks l
        JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE l.locktype = 'advisory'
          AND (
            (l.classid = 0 AND l.objid = $1)
            OR ((l.classid::bigint << 32) + l.objid::bigint = $1)
          )
        ORDER BY l.granted DESC, a.pid
      `,
      [ADVISORY_LOCK_KEY],
    );

    if (result.rows.length === 0) {
      console.warn("[Migrations] No current holder was visible in pg_locks when diagnostics ran.");
      return;
    }

    console.warn(
      "[Migrations] Advisory lock diagnostics:",
      result.rows.map((row: any) => ({
        pid: row.pid,
        applicationName: row.application_name || null,
        clientAddr: row.client_addr || null,
        state: row.state || null,
        waitEventType: row.wait_event_type || null,
        waitEvent: row.wait_event || null,
        granted: Boolean(row.granted),
        stateAge: row.state_age || null,
      })),
    );
  } catch (error: any) {
    console.warn("[Migrations] Advisory lock diagnostics query failed:", error?.message || error);
  }
}

async function acquireMigrationAdvisoryLock(client: any): Promise<boolean> {
  const { timeoutMs, retryIntervalMs } = getMigrationLockConfig();
  const startedAt = Date.now();
  let attempt = 0;

  console.log(
    `[Migrations] Attempting advisory lock ${ADVISORY_LOCK_KEY} with bounded retry ` +
    `(timeoutMs=${timeoutMs}, retryIntervalMs=${retryIntervalMs})`,
  );

  while (Date.now() - startedAt <= timeoutMs) {
    attempt += 1;
    const result = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [ADVISORY_LOCK_KEY]);
    if (result.rows[0]?.acquired === true) {
      console.log(`[Migrations] Advisory lock ${ADVISORY_LOCK_KEY} acquired on attempt ${attempt}`);
      return true;
    }

    const elapsedMs = Date.now() - startedAt;
    console.warn(
      `[Migrations] Advisory lock ${ADVISORY_LOCK_KEY} is held by another session ` +
      `(attempt=${attempt}, elapsedMs=${elapsedMs}). Retrying...`,
    );
    await sleep(Math.min(retryIntervalMs, Math.max(0, timeoutMs - elapsedMs)));
  }

  console.error(
    `[Migrations] Could not acquire advisory lock ${ADVISORY_LOCK_KEY} within ${timeoutMs}ms. ` +
    "This may be a stale pooled database session. Inspect pg_locks/pg_stat_activity before terminating sessions.",
  );
  await logAdvisoryLockDiagnostics(client);
  return false;
}

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
  | { type: "column_nullable"; table: string; column: string; label: string }
  | { type: "table_exists"; table: string; label: string }
  | { type: "index_exists"; index: string; label: string }
  | { type: "constraint_exists"; table: string; constraint: string; label: string }
  | { type: "trigger_exists"; table: string; trigger: string; label: string }
  | { type: "enum_value_exists"; enumType: string; value: string; label: string }
  | { type: "exact_foreign_key"; table: string; column: string; referencesTable: string; referencesColumn: string; onDelete: "SET NULL"; label: string }
  | { type: "row_exists"; table: string; where: string; label: string };

const RELEASE_CHECKS: ReleaseCheck[] = [
  // Migration 0225 — Formula revisions and ProductVersion bindings are a
  // runtime pricing dependency. Verify the physical domain rather than
  // trusting the migration ledger alone.
  { type: "table_exists", table: "v2_formula_identities", label: "v2_formula_identities table" },
  { type: "column_exists", table: "v2_formula_identities", column: "scope_product_id", label: "Formula identity Product scope column" },
  { type: "table_exists", table: "formula_revisions", label: "formula_revisions table" },
  { type: "table_exists", table: "v2_product_version_formula_revision_bindings", label: "v2_product_version_formula_revision_bindings table" },
  { type: "enum_value_exists", enumType: "v2_formula_visibility", value: "product_scoped", label: "Formula visibility supports product_scoped" },
  { type: "enum_value_exists", enumType: "v2_formula_visibility", value: "library", label: "Formula visibility supports library" },
  { type: "enum_value_exists", enumType: "v2_formula_status", value: "active", label: "Formula status supports active" },
  { type: "enum_value_exists", enumType: "v2_formula_status", value: "inactive", label: "Formula status supports inactive" },
  { type: "enum_value_exists", enumType: "v2_formula_status", value: "archived", label: "Formula status supports archived" },
  { type: "index_exists", index: "v2_formula_identities_catalog_idx", label: "v2_formula_identities catalog index" },
  { type: "index_exists", index: "v2_formula_identities_scope_product_idx", label: "Formula Product scope index" },
  { type: "index_exists", index: "formula_revisions_formula_idx", label: "formula_revisions formula index" },
  { type: "index_exists", index: "v2_product_version_formula_revision_formula_idx", label: "ProductVersion Formula revision binding index" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_name_uidx", label: "Formula identity tenant/name uniqueness" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_pkey", label: "Formula identity primary key" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_id_org_uidx", label: "Formula identity tenant composite identity uniqueness" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_current_revision_tenant_fk", label: "Formula identity current revision tenant foreign key" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_scope_product_tenant_fk", label: "Formula identity Product scope tenant foreign key" },
  { type: "constraint_exists", table: "v2_formula_identities", constraint: "v2_formula_identities_visibility_scope_chk", label: "Formula visibility and Product scope consistency" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_number_chk", label: "Formula revision number check" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_pkey", label: "Formula revision primary key" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_expression_chk", label: "Formula revision expression check" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_formula_tenant_fk", label: "Formula revision tenant foreign key" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_formula_number_uidx", label: "Formula revision tenant/version uniqueness" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_id_formula_org_uidx", label: "Formula revision composite identity uniqueness" },
  { type: "constraint_exists", table: "formula_revisions", constraint: "formula_revisions_id_org_uidx", label: "Formula revision tenant identity uniqueness" },
  { type: "constraint_exists", table: "v2_product_version_formula_revision_bindings", constraint: "v2_product_version_formula_revision_bindings_pkey", label: "ProductVersion Formula revision binding primary key" },
  { type: "constraint_exists", table: "v2_product_version_formula_revision_bindings", constraint: "v2_product_version_formula_revision_product_fk", label: "ProductVersion Formula revision ProductVersion foreign key" },
  { type: "constraint_exists", table: "v2_product_version_formula_revision_bindings", constraint: "v2_product_version_formula_revision_formula_fk", label: "ProductVersion Formula revision foreign key" },
  { type: "trigger_exists", table: "formula_revisions", trigger: "v2_formula_revision_immutable_trg", label: "Formula revision immutability trigger" },
  { type: "trigger_exists", table: "v2_product_version_formula_revision_bindings", trigger: "v2_product_version_formula_binding_immutable_trg", label: "ProductVersion Formula revision binding immutability trigger" },
  // Migration 0178 verifies physical repair postconditions rather than trusting
  // that a migration ledger timestamp implies the intended catalog state.
  { type: "exact_foreign_key", table: "production_runs", column: "order_id", referencesTable: "orders", referencesColumn: "id", onDelete: "SET NULL", label: "production_runs.order_id has exactly one orders(id) SET NULL FK" },
  { type: "enum_value_exists", enumType: "line_item_file_status", value: "retired", label: "line_item_file_status includes retired" },
  { type: "column_nullable", table: "orders", column: "customer_id", label: "orders.customer_id is nullable" },
  // migration 0173 - the order-centric fulfillment workspace reads these on
  // every detail request. Fail startup clearly rather than returning a 500.
  { type: "column_exists", table: "shipments", column: "shipment_reference", label: "shipments.shipment_reference" },
  { type: "table_exists", table: "shipment_packages", label: "shipment_packages table" },
  { type: "column_exists", table: "shipment_items", column: "package_id", label: "shipment_items.package_id" },
  { type: "column_exists", table: "fulfillment_checklist_items", column: "fulfilled_quantity", label: "fulfillment_checklist_items.fulfilled_quantity" },
  // migration 0172 - vendor purchasing fields are selected by the material
  // repository, so startup must fail clearly instead of serving an empty UI.
  { type: "column_exists", table: "materials", column: "inventory_units_per_purchase_unit", label: "materials.inventory_units_per_purchase_unit" },
  { type: "column_exists", table: "materials", column: "minimum_purchase_quantity", label: "materials.minimum_purchase_quantity" },
  { type: "column_exists", table: "purchase_order_line_items", column: "inventory_units_per_purchase_unit", label: "purchase_order_line_items.inventory_units_per_purchase_unit" },
  // migration 0169 - repair historical allocation-column drift that blocks
  // the compatibility projection within canonical artwork upload transactions.
  { type: "column_exists", table: "order_attachments", column: "production_quantity", label: "order_attachments.production_quantity" },
  { type: "column_exists", table: "order_attachments", column: "production_group_id", label: "order_attachments.production_group_id" },
  // migration 0170 - repair the matching line-item-file projection columns.
  { type: "column_exists", table: "line_item_files", column: "production_quantity", label: "line_item_files.production_quantity" },
  { type: "column_exists", table: "line_item_files", column: "production_group_id", label: "line_item_files.production_group_id" },
  // migration 0177 - repair the remaining quote-side allocation projection.
  // Quote-to-order conversion reads these before canonical artwork is created.
  { type: "column_exists", table: "quote_attachments", column: "production_quantity", label: "quote_attachments.production_quantity" },
  { type: "column_exists", table: "quote_attachments", column: "production_group_id", label: "quote_attachments.production_group_id" },
  { type: "column_exists", table: "quote_attachments", column: "production_role", label: "quote_attachments.production_role" },
  // migration 0070 - production completion recovery.
  { type: "column_exists", table: "production_jobs", column: "completed_by_user_id", label: "production_jobs.completed_by_user_id" },
  { type: "column_exists", table: "production_jobs", column: "previous_status", label: "production_jobs.previous_status" },
  { type: "column_exists", table: "production_jobs", column: "previous_station", label: "production_jobs.previous_station" },
  { type: "column_exists", table: "production_jobs", column: "restore_until", label: "production_jobs.restore_until" },
  { type: "column_exists", table: "production_jobs", column: "restored_at", label: "production_jobs.restored_at" },
  { type: "column_exists", table: "production_jobs", column: "restored_by_user_id", label: "production_jobs.restored_by_user_id" },
  { type: "column_exists", table: "production_jobs", column: "restore_reason", label: "production_jobs.restore_reason" },
  // migration 0059 - staff-controlled portal file visibility.
  { type: "column_exists", table: "order_attachments", column: "customer_visible", label: "order_attachments.customer_visible" },
  { type: "column_exists", table: "quote_attachments", column: "customer_visible", label: "quote_attachments.customer_visible" },
  { type: "column_exists", table: "order_attachments", column: "portal_file_category", label: "order_attachments.portal_file_category" },
  { type: "column_exists", table: "quote_attachments", column: "portal_file_category", label: "quote_attachments.portal_file_category" },
  // migration 0058 - PBV2 reusable option group templates.
  { type: "table_exists", table: "pbv2_option_group_templates", label: "pbv2_option_group_templates table" },
  // migration 0057 — quote line routing/design repair (guards production schema drift)
  { type: "column_exists", table: "quote_line_items", column: "requires_design", label: "quote_line_items.requires_design" },
  { type: "column_exists", table: "quote_line_items", column: "requires_prepress", label: "quote_line_items.requires_prepress" },
  { type: "column_exists", table: "quote_line_items", column: "requires_design_snapshot", label: "quote_line_items.requires_design_snapshot" },
  { type: "column_exists", table: "quote_line_items", column: "production_notes", label: "quote_line_items.production_notes" },
  // migration 0032 — proof approval snapshot
  { type: "column_exists", table: "quote_line_items", column: "requires_proof_approval", label: "quote_line_items.requires_proof_approval" },
  // migration 0033 — DDL canary (proves DDL + DML execution reached this DB)
  { type: "table_exists", table: "_migrations_v2_canary", label: "_migrations_v2_canary table" },
  { type: "row_exists",   table: "_migrations_v2_canary", where: "id = 1", label: "_migrations_v2_canary row id=1" },
  // migration 0034 — fulfillment station seeded.
  // The ledger check (id >= 34) confirms Drizzle applied migration 0034 regardless of org count.
  // The stations data check confirms at least one fulfillment station row exists; the
  // OR clause handles zero-org DBs (migration inserts nothing from a cross join on zero rows).
  { type: "row_exists", table: "__drizzle_migrations_v2", where: "id >= 34", label: "migration 0034_fulfillment_station recorded in ledger (id >= 34)" },
  { type: "row_exists", table: "stations", where: "key = 'fulfillment' OR NOT EXISTS (SELECT 1 FROM organizations)", label: "stations.key='fulfillment' exists (migration 0034 data)" },

  // migrations 0109-0114 — customer/contact migration, portal onboarding,
  // purchase-order numbering, PO related order linkage, and printer profiles.
  { type: "column_exists", table: "customer_contact_links", column: "is_proof", label: "customer_contact_links.is_proof" },
  { type: "column_exists", table: "customer_contact_links", column: "source_record_id", label: "customer_contact_links.source_record_id" },
  { type: "table_exists", table: "external_identity_mappings", label: "external_identity_mappings table" },
  { type: "table_exists", table: "customer_contact_import_batches", label: "customer_contact_import_batches table" },
  { type: "table_exists", table: "customer_contact_import_company_records", label: "customer_contact_import_company_records table" },
  { type: "table_exists", table: "customer_contact_import_contact_records", label: "customer_contact_import_contact_records table" },
  { type: "table_exists", table: "customer_contact_import_relationship_records", label: "customer_contact_import_relationship_records table" },
  { type: "table_exists", table: "customer_contact_quickbooks_source_snapshots", label: "customer_contact_quickbooks_source_snapshots table" },
  { type: "table_exists", table: "customer_portal_company_settings", label: "customer_portal_company_settings table" },
  { type: "table_exists", table: "customer_portal_onboarding_batches", label: "customer_portal_onboarding_batches table" },
  { type: "table_exists", table: "customer_portal_onboarding_batch_items", label: "customer_portal_onboarding_batch_items table" },
  { type: "column_exists", table: "customer_portal_access", column: "access_role", label: "customer_portal_access.access_role" },
  { type: "index_exists", index: "purchase_orders_org_po_number_unique", label: "purchase_orders_org_po_number_unique index" },
  { type: "column_exists", table: "purchase_orders", column: "related_order_id", label: "purchase_orders.related_order_id" },
  { type: "index_exists", index: "purchase_orders_related_order_id_idx", label: "purchase_orders_related_order_id_idx index" },
  { type: "table_exists", table: "printer_profiles", label: "printer_profiles table" },
  { type: "index_exists", index: "printer_profiles_org_default_use_uidx", label: "printer_profiles_org_default_use_uidx index" },
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
      } else if (check.type === "column_nullable") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2 AND is_nullable = 'YES'
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
      } else if (check.type === "index_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public' AND indexname = $1
           ) AS ok`,
          [check.index],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "constraint_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_constraint c
             JOIN pg_class relation ON relation.oid = c.conrelid
             JOIN pg_namespace schema ON schema.oid = relation.relnamespace
             WHERE schema.nspname = 'public' AND relation.relname = $1 AND c.conname = $2
           ) AS ok`,
          [check.table, check.constraint],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "trigger_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_trigger tg
             JOIN pg_class relation ON relation.oid = tg.tgrelid
             JOIN pg_namespace schema ON schema.oid = relation.relnamespace
             WHERE schema.nspname = 'public' AND relation.relname = $1 AND tg.tgname = $2
               AND NOT tg.tgisinternal
           ) AS ok`,
          [check.table, check.trigger],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "enum_value_exists") {
        const res = await client.query(
          `SELECT EXISTS (
             SELECT 1
             FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace
             JOIN pg_enum e ON e.enumtypid = t.oid
             WHERE n.nspname = 'public' AND t.typname = $1 AND e.enumlabel = $2
           ) AS ok`,
          [check.enumType, check.value],
        );
        exists = res.rows[0].ok;
      } else if (check.type === "exact_foreign_key") {
        const res = await client.query(
          `SELECT pg_get_constraintdef(c.oid) AS definition
           FROM pg_constraint c
           JOIN pg_class source_table ON source_table.oid = c.conrelid
           JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
           WHERE source_schema.nspname = 'public' AND source_table.relname = $1 AND c.contype = 'f'`,
          [check.table],
        );
        const relation = new RegExp(
          `^FOREIGN KEY \\(${check.column}\\) REFERENCES (?:public\\.)?${check.referencesTable}\\(${check.referencesColumn}\\)`,
          "i",
        );
        const matching = res.rows.filter((row: { definition?: string }) => relation.test(row.definition ?? ""));
        exists = matching.length === 1 && new RegExp(`ON DELETE ${check.onDelete}$`, "i").test(matching[0]?.definition ?? "");
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
 * Advisory lock: uses bounded pg_try_advisory_lock retries so concurrent
 * instances (e.g. rolling deploy with two pods) do not race on migrations and
 * startup cannot hang forever behind a stale pooled session.
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

  const autoMigrate = parseAutoMigrateConfig();
  console.log(
    `[Migrations] DRIZZLE_AUTO_MIGRATE raw=${JSON.stringify(autoMigrate.raw)} ` +
    `parsed=${JSON.stringify(autoMigrate.parsed)}`,
  );
  if (!autoMigrate.enabled) {
    console.log("[Migrations] DRIZZLE_AUTO_MIGRATE=disabled — skipping auto-migration");
    console.log("[Migrations] Release verification checks are also skipped because auto-migration is disabled.");
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

  // Log the highest journal idx AND highest 'when' timestamp from the PACKAGED migrations.
  //
  // CRITICAL — Drizzle's migrator skips any migration whose 'when' (folderMillis) is ≤ the
  // MAX(created_at) currently in the ledger. It is NOT index-based. If a future migration is
  // authored with a 'when' value lower than a previously-applied migration's 'when', it will be
  // silently skipped forever (e.g., 0034 was skipped because 0031 had when=2026-04-15 but 0034
  // was manually authored with when=2025-04-28). Every new migration's 'when' MUST be strictly
  // greater than the highest 'when' currently in the packaged journal.
  //
  // If the startup log shows a lower idx or lower maxWhen than expected:
  //   → the build artifact is stale — re-run npm run build (Railway: clear cache and redeploy).
  // If maxWhen in the journal < MAX(created_at) in the ledger:
  //   → the next migration's 'when' is too low and it will be silently skipped.
  try {
    const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
    const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    const entries: Array<{ idx: number; tag: string; when: number }> = journal.entries ?? [];
    const maxIdx = entries.length > 0 ? Math.max(...entries.map((e) => e.idx)) : -1;
    const maxWhen = entries.length > 0 ? Math.max(...entries.map((e) => e.when)) : -1;
    const lastEntry = entries.find((e) => e.idx === maxIdx);
    const maxWhenEntry = entries.find((e) => e.when === maxWhen);
    console.log(
      `[Migrations] Packaged journal: ${entries.length} entries, highest idx = ${maxIdx} (${lastEntry?.tag ?? "unknown"}), highest when = ${maxWhen} (${maxWhenEntry?.tag ?? "unknown"} — ${new Date(maxWhen).toISOString()})`,
    );

    // Monotonicity audit — log any idx whose 'when' is not strictly greater than
    // the previous idx's 'when'. These are silent skip risks: if such a migration
    // hasn't been applied yet and a later migration with a higher 'when' has been,
    // it will be skipped forever.
    const sorted = entries.slice().sort((a, b) => a.idx - b.idx);
    const nonMonotonic: string[] = [];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].when <= sorted[i - 1].when) {
        nonMonotonic.push(
          `idx=${sorted[i].idx} (${sorted[i].tag}) when=${sorted[i].when} <= idx=${sorted[i-1].idx} (${sorted[i-1].tag}) when=${sorted[i-1].when}`,
        );
      }
    }
    if (nonMonotonic.length > 0) {
      console.warn(
        `[Migrations] WARNING: ${nonMonotonic.length} non-monotonic 'when' value(s) in journal — ` +
        `migrations with 'when' <= a prior migration's 'when' will be silently skipped if the prior one was applied first:\n` +
        nonMonotonic.map((m) => `  • ${m}`).join("\n"),
      );
    } else {
      console.log(`[Migrations] Journal 'when' values are strictly monotonic — no silent-skip risk.`);
    }
  } catch (e: any) {
    console.error(
      `[Migrations] WARNING: could not read packaged journal — ${e?.message}. ` +
      `Verify scripts/copy-migrations.mjs ran during build and meta/_journal.json is present.`,
    );
  }

  // Acquire a session-level advisory lock on a dedicated migration connection so
  // concurrent server instances do not run migrations simultaneously.
  // Use bounded pg_try_advisory_lock retries; never use unbounded
  // pg_advisory_lock here, especially through pooled Neon/PgBouncer URLs.
  // Do not switch this to pg_advisory_xact_lock unless Drizzle migrations are
  // also executed on the same transaction/client; the migrator owns its own
  // execution path, so a transaction-level lock here would not cover it.
  const migrationRuntime = await createMigrationRuntime();
  let lockAcquired = false;
  let client: any | null = null;
  try {
    client = await (migrationRuntime.pool as any).connect();
    lockAcquired = await acquireMigrationAdvisoryLock(client);
    if (!lockAcquired) {
      throw new Error(`Could not acquire migration advisory lock ${ADVISORY_LOCK_KEY}`);
    }
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

    // Highest ledger id and created_at before migrate.
    // -1 means table doesn't exist yet (fresh DB).
    // CRITICAL: Drizzle skips any migration whose journal 'when' ≤ MAX(created_at) in the ledger.
    // If max_created_at here is higher than an upcoming migration's journal 'when', that migration
    // will be silently skipped. Compare against the packaged journal's highest 'when' above.
    try {
      const preRes = await client.query(
        `SELECT COALESCE(MAX(id), -1) AS max_id, COALESCE(MAX(created_at), -1) AS max_created_at FROM public.${MIGRATIONS_TABLE}`
      );
      const { max_id, max_created_at } = preRes.rows[0];
      const maxCreatedAtDate = max_created_at > 0 ? new Date(Number(max_created_at)).toISOString() : "n/a";
      console.log(`[Migrations] Ledger before migrate: max_id=${max_id}, max_created_at=${max_created_at} (${maxCreatedAtDate})`);
    } catch (e: any) {
      console.log(`[Migrations] Ledger before migrate: table not yet created (fresh database)`);
    }

    console.log("[Migrations] Calling drizzle migrate() now...");
    await migrate(migrationRuntime.db, {
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
    if (lockAcquired && client) {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
      } catch {
        // Ignore release errors; the lock is released when the connection closes anyway.
      }
    }
    client?.release();
    await migrationRuntime.close();
  }
}
