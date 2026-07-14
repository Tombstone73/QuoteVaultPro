import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

type MigrationSpec = {
  idx: number;
  tag: string;
  file: string;
  checks: Array<{ kind: "table" | "column" | "index"; table?: string; column?: string; name?: string }>;
};

const MIGRATIONS: MigrationSpec[] = [
  {
    idx: 109,
    tag: "0109_customer_contact_migration_workflow",
    file: "0109_customer_contact_migration_workflow.sql",
    checks: [
      { kind: "column", table: "customer_contact_links", column: "is_proof" },
      { kind: "column", table: "customer_contact_links", column: "source_record_id" },
      { kind: "table", name: "external_identity_mappings" },
      { kind: "table", name: "customer_contact_import_batches" },
      { kind: "table", name: "customer_contact_import_company_records" },
      { kind: "table", name: "customer_contact_import_contact_records" },
      { kind: "table", name: "customer_contact_import_relationship_records" },
      { kind: "index", name: "external_identity_mappings_source_uidx" },
      { kind: "index", name: "cc_import_relationship_contact_idx" },
    ],
  },
  {
    idx: 110,
    tag: "0110_customer_contact_migration_qb_source_snapshots",
    file: "0110_customer_contact_migration_qb_source_snapshots.sql",
    checks: [
      { kind: "table", name: "customer_contact_quickbooks_source_snapshots" },
      { kind: "index", name: "cc_qb_source_snapshots_org_created_idx" },
      { kind: "index", name: "cc_qb_source_snapshots_org_status_idx" },
    ],
  },
  {
    idx: 111,
    tag: "0111_customer_portal_bulk_onboarding",
    file: "0111_customer_portal_bulk_onboarding.sql",
    checks: [
      { kind: "table", name: "customer_portal_company_settings" },
      { kind: "column", table: "customer_portal_access", column: "access_role" },
      { kind: "table", name: "customer_portal_onboarding_batches" },
      { kind: "table", name: "customer_portal_onboarding_batch_items" },
      { kind: "index", name: "customer_portal_onboarding_batch_items_status_idx" },
    ],
  },
  {
    idx: 112,
    tag: "0112_purchase_order_numbering",
    file: "0112_purchase_order_numbering.sql",
    checks: [
      { kind: "index", name: "purchase_orders_org_po_number_unique" },
    ],
  },
  {
    idx: 113,
    tag: "0113_purchase_order_related_order",
    file: "0113_purchase_order_related_order.sql",
    checks: [
      { kind: "column", table: "purchase_orders", column: "related_order_id" },
      { kind: "index", name: "purchase_orders_related_order_id_idx" },
    ],
  },
  {
    idx: 114,
    tag: "0114_printer_profiles",
    file: "0114_printer_profiles.sql",
    checks: [
      { kind: "table", name: "printer_profiles" },
      { kind: "index", name: "printer_profiles_org_idx" },
      { kind: "index", name: "printer_profiles_org_default_use_uidx" },
    ],
  },
];

const migrationsDir = path.resolve("server/db/migrations_v2");
const journalPath = path.join(migrationsDir, "meta/_journal.json");

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function exists(client: Client, check: MigrationSpec["checks"][number]): Promise<boolean> {
  if (check.kind === "table") {
    const res = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS ok`,
      [`public.${check.name}`],
    );
    return Boolean(res.rows[0]?.ok);
  }
  if (check.kind === "column") {
    const res = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
       ) AS ok`,
      [check.table, check.column],
    );
    return Boolean(res.rows[0]?.ok);
  }
  const res = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = $1
     ) AS ok`,
    [check.name],
  );
  return Boolean(res.rows[0]?.ok);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for the read-only migration audit.");

  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: Array<{ idx: number; tag: string; when: number }> };
  const journalEntries = journal.entries ?? [];
  const journalByTag = new Map(journalEntries.map((entry) => [entry.tag, entry]));
  const sourceFiles = new Set(readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")));

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  try {
    const dbIdentity = await client.query("SELECT current_database() AS database, current_user AS username, inet_server_addr()::text AS server_addr");
    console.log("[audit] database", dbIdentity.rows[0]);

    const migrationTables = await client.query(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_name IN ('__drizzle_migrations', '__drizzle_migrations_v2')
      ORDER BY table_schema, table_name
    `);
    console.log("[audit] migration tracking tables", migrationTables.rows);

    for (const tableRef of ["drizzle.__drizzle_migrations", "public.__drizzle_migrations", "public.__drizzle_migrations_v2"]) {
      const existsResult = await client.query("SELECT to_regclass($1) AS table_ref", [tableRef]);
      if (!existsResult.rows[0]?.table_ref) {
        console.log(`[audit] ${tableRef}: missing`);
        continue;
      }
      const rows = await client.query(`SELECT * FROM ${tableRef} ORDER BY created_at`);
      console.log(`[audit] ${tableRef}: ${rows.rowCount} row(s)`);
      console.log(rows.rows.slice(-8));
    }

    const report = [];
    for (const migration of MIGRATIONS) {
      const filePresent = sourceFiles.has(migration.file);
      const fileText = filePresent ? readFileSync(path.join(migrationsDir, migration.file), "utf8") : "";
      const checks = [];
      for (const check of migration.checks) {
        checks.push({ ...check, exists: await exists(client, check) });
      }
      report.push({
        idx: migration.idx,
        tag: migration.tag,
        filePresent,
        sourceSha256: filePresent ? sha256(fileText) : null,
        journalEntry: journalByTag.get(migration.tag) ?? null,
        schemaChecks: checks,
        allSchemaEffectsPresent: checks.every((check) => check.exists),
      });
    }

    console.log(JSON.stringify({ migrations: report }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[audit] failed", error instanceof Error ? error.message : error);
  process.exit(1);
});
