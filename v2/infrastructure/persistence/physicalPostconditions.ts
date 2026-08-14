import type { TransactionalClient } from "./types";

export type PhysicalPostcondition = { id: string; passed: boolean; detail: string };

const REQUIRED_TABLES = ["v2_operation_requests", "v2_principal_attributions", "v2_outbox_messages"] as const;
const REQUIRED_INDEXES = [
  "v2_operation_requests_org_status_available_idx",
  "v2_operation_requests_business_request_uidx",
  "v2_operation_requests_id_organization_uidx",
  "v2_principal_attributions_org_resource_idx",
  "v2_principal_attributions_operation_request_idx",
  "v2_outbox_messages_identity_uidx",
  "v2_outbox_messages_claim_idx",
  "v2_outbox_messages_lease_idx",
] as const;
const REQUIRED_CONSTRAINTS = [
  "v2_operation_requests_status_chk",
  "v2_operation_requests_principal_kind_chk",
  "v2_operation_requests_completion_chk",
  "v2_principal_attributions_principal_kind_chk",
  "v2_principal_attributions_request_tenant_fk",
  "v2_outbox_messages_status_chk",
  "v2_outbox_messages_attempt_count_chk",
  "v2_outbox_messages_lease_chk",
  "v2_outbox_messages_completion_chk",
] as const;
const REQUIRED_FOREIGN_KEYS = [
  "v2_operation_requests:organizations",
  "v2_operation_requests:users",
  "v2_principal_attributions:v2_operation_requests",
  "v2_principal_attributions:organizations",
  "v2_principal_attributions:users",
  "v2_outbox_messages:organizations",
] as const;

/** Read-only catalog verification for the M0 additive migration. */
export async function checkV2M0PhysicalPostconditions(client: TransactionalClient): Promise<PhysicalPostcondition[]> {
  const [tableResult, indexResult, constraintResult, foreignKeyResult, columnResult] = await Promise.all([
    client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [REQUIRED_TABLES],
    ),
    client.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
      [REQUIRED_INDEXES],
    ),
    client.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])`,
      [REQUIRED_CONSTRAINTS],
    ),
    client.query<{ source_table: string; target_table: string }>(
      `SELECT source.relname AS source_table, target.relname AS target_table
       FROM pg_constraint constraint
       JOIN pg_class source ON source.oid = constraint.conrelid
       JOIN pg_class target ON target.oid = constraint.confrelid
       WHERE constraint.contype = 'f'
         AND source.relname = ANY($1::text[])
         AND target.relname = ANY($2::text[])`,
      [["v2_operation_requests", "v2_principal_attributions", "v2_outbox_messages"], ["organizations", "users", "v2_operation_requests"]],
    ),
    client.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND (table_name, column_name) IN (
         ('v2_operation_requests', 'organization_id'), ('v2_operation_requests', 'business_request_id'),
         ('v2_operation_requests', 'payload_fingerprint'), ('v2_principal_attributions', 'principal_subject'),
         ('v2_outbox_messages', 'idempotency_key'), ('v2_outbox_messages', 'payload')
       )`,
    ),
  ]);
  const tables = new Set(tableResult.rows.map((row) => row.table_name));
  const indexes = new Map(indexResult.rows.map((row) => [row.indexname, row.indexdef]));
  const constraints = new Set(constraintResult.rows.map((row) => row.conname));
  const foreignKeys = new Set(foreignKeyResult.rows.map((row) => `${row.source_table}:${row.target_table}`));
  const columns = new Map(columnResult.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.is_nullable]));

  return [
    ...REQUIRED_TABLES.map((id) => ({ id: `table:${id}`, passed: tables.has(id), detail: "required M0 table" })),
    ...REQUIRED_INDEXES.map((id) => ({ id: `index:${id}`, passed: indexes.has(id), detail: "required M0 index" })),
    ...["v2_operation_requests_business_request_uidx", "v2_operation_requests_id_organization_uidx", "v2_outbox_messages_identity_uidx"].map((id) => ({
      id: `unique-index:${id}`,
      passed: /\bUNIQUE\b/i.test(indexes.get(id) ?? ""),
      detail: "required unique M0 index",
    })),
    ...REQUIRED_CONSTRAINTS.map((id) => ({ id: `constraint:${id}`, passed: constraints.has(id), detail: "required M0 constraint" })),
    ...REQUIRED_FOREIGN_KEYS.map((id) => ({ id: `foreign-key:${id}`, passed: foreignKeys.has(id), detail: "required M0 foreign key" })),
    ...["v2_operation_requests.organization_id", "v2_operation_requests.business_request_id", "v2_operation_requests.payload_fingerprint", "v2_principal_attributions.principal_subject", "v2_outbox_messages.idempotency_key", "v2_outbox_messages.payload"].map((id) => ({
      id: `not-null:${id}`,
      passed: columns.get(id) === "NO",
      detail: "required non-null column",
    })),
  ];
}

export function assertV2M0PhysicalPostconditions(findings: readonly PhysicalPostcondition[]): void {
  const failed = findings.filter((finding) => !finding.passed);
  if (failed.length > 0) throw new Error(`V2 M0 physical postconditions failed: ${failed.map((finding) => finding.id).join(", ")}`);
}
