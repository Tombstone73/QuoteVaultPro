/**
 * Read-only physical-schema contract audit.
 *
 * This intentionally accepts only TEST_DATABASE_URL. It never falls back to
 * application or migration URLs, and every catalog query runs after
 * BEGIN READ ONLY. It is suitable for a disposable DEV clone or CI database.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

type JournalEntry = { idx: number; tag: string; when: number };
type Finding = { id: string; result: "MATCH" | "PHYSICAL MISSING" | "PHYSICAL DIFFERENT" | "MIGRATION HISTORY GAP"; detail: string };

function requiredTestUrl(): string {
  const url = (process.env.TEST_DATABASE_URL ?? "").trim();
  if (!url) throw new Error("TEST_DATABASE_URL is required; this audit never falls back to another database URL.");
  for (const key of ["DATABASE_URL", "DIRECT_DATABASE_URL", "MIGRATION_DATABASE_URL"]) {
    const other = (process.env[key] ?? "").trim();
    if (other && other === url) throw new Error(`TEST_DATABASE_URL must not equal ${key}.`);
  }
  return url;
}

function journal(): JournalEntry[] {
  const file = path.resolve("server/db/migrations_v2/meta/_journal.json");
  return (JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: JournalEntry[] }).entries ?? [];
}

async function main() {
  const client = new Client({ connectionString: requiredTestUrl() });
  const findings: Finding[] = [];
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const readOnly = await client.query<{ transaction_read_only: string }>("SHOW transaction_read_only");
    if (readOnly.rows[0]?.transaction_read_only !== "on") throw new Error("Database did not enter read-only mode.");

    const [ledgerResult, enumResult, columnResult, constraintResult, indexResult] = await Promise.all([
      client.query<{ created_at: string }>("SELECT created_at FROM public.__drizzle_migrations_v2"),
      client.query<{ typname: string; enumlabel: string }>(`
        SELECT t.typname, e.enumlabel
        FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE n.nspname = 'public' AND t.typname IN ('line_item_file_status')
      `),
      client.query<{ table_name: string; column_name: string; is_nullable: string }>(`
        SELECT table_name, column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (
          ('orders','customer_id'), ('quote_attachments','production_quantity'),
          ('quote_attachments','production_group_id'), ('quote_attachments','production_role'),
          ('pickup_handoffs','client_request_id')
        )
      `),
      client.query<{ conname: string; definition: string }>(`
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE conrelid = 'public.production_runs'::regclass
      `),
      client.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
          'pickup_handoffs_ticket_request_uidx', 'payment_webhook_events_provider_event_id_uidx',
          'payments_org_provider_idempotency_key_uidx', 'payments_org_provider_transaction_id_uidx'
        )
      `),
    ]);

    const enumValues = new Set(enumResult.rows.filter((r) => r.typname === "line_item_file_status").map((r) => r.enumlabel));
    findings.push(enumValues.has("retired")
      ? { id: "line_item_file_status.retired", result: "MATCH", detail: "Required enum value exists." }
      : { id: "line_item_file_status.retired", result: "PHYSICAL MISSING", detail: "Runtime-required enum value is absent." });

    const nullable = new Map(columnResult.rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable]));
    findings.push(nullable.get("orders.customer_id") === "YES"
      ? { id: "orders.customer_id nullable", result: "MATCH", detail: "Contact-only orders are physically supported." }
      : { id: "orders.customer_id nullable", result: "PHYSICAL DIFFERENT", detail: "Runtime permits contact-only orders but the column is not nullable." });
    for (const column of ["quote_attachments.production_quantity", "quote_attachments.production_group_id", "quote_attachments.production_role", "pickup_handoffs.client_request_id"]) {
      findings.push(nullable.has(column)
        ? { id: column, result: "MATCH", detail: "Required column exists." }
        : { id: column, result: "PHYSICAL MISSING", detail: "Required column is absent." });
    }

    const orderFks = constraintResult.rows.filter((r) => /FOREIGN KEY \(order_id\)/i.test(r.definition));
    const setNullOnly = orderFks.length === 1 && /ON DELETE SET NULL/i.test(orderFks[0].definition);
    findings.push(setNullOnly
      ? { id: "production_runs.order_id FK", result: "MATCH", detail: "Exactly one SET NULL order FK exists." }
      : { id: "production_runs.order_id FK", result: "PHYSICAL DIFFERENT", detail: `${orderFks.length} order FK(s) exist; current contract requires exactly one ON DELETE SET NULL FK.` });

    const indexes = new Set(indexResult.rows.map((r) => r.indexname));
    for (const index of ["pickup_handoffs_ticket_request_uidx", "payment_webhook_events_provider_event_id_uidx", "payments_org_provider_idempotency_key_uidx", "payments_org_provider_transaction_id_uidx"]) {
      findings.push(indexes.has(index)
        ? { id: index, result: "MATCH", detail: "Required integrity index exists." }
        : { id: index, result: "PHYSICAL MISSING", detail: "Required integrity index is absent." });
    }

    const ledgerWhens = new Set(ledgerResult.rows.map((r) => Number(r.created_at)));
    const missingJournalEntries = journal().filter((entry) => !ledgerWhens.has(Number(entry.when))).map((entry) => entry.tag);
    findings.push(missingJournalEntries.length === 0
      ? { id: "migration journal timestamps", result: "MATCH", detail: "Every journal timestamp has a ledger entry." }
      : { id: "migration journal timestamps", result: "MIGRATION HISTORY GAP", detail: `Journal entries absent from ledger: ${missingJournalEntries.join(", ")}.` });

    const database = await client.query<{ current_database: string }>("SELECT current_database()");
    console.log(JSON.stringify({
      audit: "physical-schema-contract",
      database: database.rows[0]?.current_database ?? "unknown",
      transactionReadOnly: true,
      findings,
      mismatchCount: findings.filter((f) => f.result !== "MATCH").length,
    }, null, 2));
    process.exitCode = findings.some((f) => f.result !== "MATCH") ? 2 : 0;
  } finally {
    try { await client.query("ROLLBACK"); } catch { /* no transaction to roll back */ }
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[auditPhysicalSchema] failed safely:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
