/**
 * Read-only DEV hygiene inventory. No repair, archive, retry, provider or delete operations.
 * Run with the Railway DEV environment and exactly one scope:
 *   npx tsx v2/scripts/reportDevHistoricalDataHygiene.ts --organization-id <id>
 *   npx tsx v2/scripts/reportDevHistoricalDataHygiene.ts --all-organizations
 * stdout is JSON containing IDs/counts/states only; customer and provider data are omitted.
 */
import type { PoolClient, QueryResultRow } from "pg";
import { historicalDataDisposition, historicalDataScope, readOnlyDevSnapshot, type HygieneDisposition } from "./devHistoricalDataHygienePolicy.js";

type Row = QueryResultRow & Record<string, unknown>;
type Disposition = HygieneDisposition;
const fixtureOrganization = /^(?:m21(?:-other)?|m22(?:-other)?|m23(?:-other)?|p7b-org|p7c(?:-other)?|p7d(?:-other)?|routing-http-org)-[0-9a-f-]{36}$/i;
const markerSql = "(^|[^a-z0-9])(dev[ -]?qa|qa|fixture|rehearsal|smoke|migration[ -]?test)([^a-z0-9]|$)";
const classify = (row: Row, disposition: Disposition, reason: string): Row => ({ ...row, disposition, reason });
const isFixture = (row: Row): boolean => fixtureOrganization.test(String(row.organization_id));
const counts = (rows: Row[], key: string): Record<string, number> => rows.reduce<Record<string, number>>((result, row) => {
  const value = String(row[key]); result[value] = (result[value] ?? 0) + 1; return result;
}, {});

async function inventory(client: PoolClient, organizationId: string | null) {
  const query = async (sql: string): Promise<Row[]> => (await client.query<Row>(sql, [organizationId])).rows;
  const organizations = await query(`SELECT o.id organization_id,o.is_archived,
    o.name ~* '${markerSql}' name_has_qa_marker,o.name ~* '^sandbox([[:space:]]|$)' sandbox_name_marker,
    (SELECT count(*)::int FROM products p WHERE p.organization_id=o.id) product_count,
    (SELECT count(*)::int FROM v2_sales_documents d WHERE d.organization_id=o.id) sales_document_count,
    (SELECT count(*)::int FROM v2_billing_payments p WHERE p.organization_id=o.id) payment_count
    FROM organizations o WHERE ($1::text IS NULL OR o.id=$1) ORDER BY o.id`);
  if (organizationId && organizations.length !== 1) throw new Error("Requested organization does not exist in the guarded DEV target.");

  const salesDocuments = (await query(`SELECT d.organization_id,d.id document_id,d.document_kind,d.display_number,d.customer_id,d.created_at,d.updated_at,
    COALESCE(c.display_name,c.company_name,'') ~* '${markerSql}' customer_has_qa_marker,
    EXISTS(SELECT 1 FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id AND l.description ~* '${markerSql}') line_has_qa_marker,
    o.commercial_state,o.archived_at,o.completed_at,q.acceptance_state,q.lifecycle_state,
    (SELECT count(*)::int FROM v2_sales_document_lines l WHERE l.organization_id=d.organization_id AND l.document_id=d.id) line_count,
    (SELECT count(*)::int FROM v2_billing_invoices i WHERE i.organization_id=d.organization_id AND i.sales_order_document_id=d.id) invoice_count,
    (SELECT count(*)::int FROM v2_sales_quote_checkpoints cp WHERE cp.organization_id=d.organization_id AND cp.quote_document_id=d.id) quote_checkpoint_count,
    (SELECT count(*)::int FROM v2_audit_events a WHERE a.organization_id=d.organization_id AND a.resource_id=d.id) audit_event_count
    FROM v2_sales_documents d LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
    LEFT JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id
    LEFT JOIN v2_sales_quote_details q ON q.organization_id=d.organization_id AND q.document_id=d.id
    WHERE ($1::text IS NULL OR d.organization_id=$1) ORDER BY d.organization_id,d.document_kind,d.created_at,d.id`))
    .map(row => classify({ ...row, provenance: isFixture(row) ? "known_rehearsal_organization_id" : row.customer_has_qa_marker || row.line_has_qa_marker ? "qa_label_signal_only" : "unproven" },
      historicalDataDisposition("sales_document", row), "Sales/checkpoint/audit dependencies require retention; a QA label is not deletion authorization."));

  const productVersions = (await query(`SELECT v.organization_id,v.id version_id,v.product_id,v.status,v.schema_version,v.created_at,v.updated_at,
    v.updated_at < now()-interval '30 days' older_than_30_days,p.id IS NULL missing_product,
    p.is_active product_active,p.pbv2_active_tree_version_id=v.id active_pointer,p.name ~* '${markerSql}' product_has_qa_marker,
    (SELECT count(*)::int FROM v2_product_recipes r WHERE r.organization_id=v.organization_id AND r.product_version_id=v.id) recipe_count,
    (SELECT count(*)::int FROM v2_product_version_formula_revision_bindings f WHERE f.organization_id=v.organization_id AND f.product_version_id=v.id) formula_binding_count,
    (SELECT count(*)::int FROM v2_product_version_routing_specs r WHERE r.organization_id=v.organization_id AND r.product_version_id=v.id) routing_spec_count,
    (SELECT count(*)::int FROM v2_sales_document_lines l WHERE l.organization_id=v.organization_id AND l.product_id=v.product_id) product_sales_line_count,
    (SELECT count(*)::int FROM v2_sales_document_lines l WHERE l.organization_id=v.organization_id AND
      (l.resolved_configuration::text LIKE '%'||v.id||'%' OR l.pricing_result::text LIKE '%'||v.id||'%')) sales_snapshot_reference_count,
    (SELECT count(*)::int FROM v2_order_line_material_requirements r WHERE r.organization_id=v.organization_id AND r.source_product_version_id=v.id) material_snapshot_reference_count
    FROM pbv2_tree_versions v LEFT JOIN products p ON p.organization_id=v.organization_id AND p.id=v.product_id
    WHERE ($1::text IS NULL OR v.organization_id=$1) ORDER BY v.organization_id,v.product_id,v.created_at,v.id`))
    .map(row => classify({ ...row, provenance: isFixture(row) ? "known_rehearsal_organization_id" : row.product_has_qa_marker ? "qa_label_signal_only" : "unproven" },
      historicalDataDisposition("product_version", row),
      row.status === "DRAFT" ? "Age and no detected references do not prove abandonment; retain pending owner decision." : "Published/deprecated versions and snapshots preserve pricing/routing recovery history."));

  // Same base eligibility as the canonical Prepress repository, before UI view selection.
  const prepress = (await query(`SELECT d.organization_id,d.id order_id,d.display_number,l.id line_id,d.customer_id,l.created_at,
    COALESCE(c.display_name,c.company_name,'') ~* '${markerSql}' customer_has_qa_marker,
    l.production_requirement_state,l.production_requirement_count,l.production_requirement_fingerprint IS NOT NULL has_requirement_fingerprint,
    jsonb_typeof(l.resolved_configuration) resolved_configuration_type,l.resolved_configuration='{}'::jsonb empty_resolved_configuration,
    l.pricing_result='{}'::jsonb empty_pricing_result,
    ri.id route_instance_id,ri.route_state,step.step_kind current_step,
    (SELECT count(*)::int FROM v2_sales_line_production_requirements r WHERE r.organization_id=l.organization_id AND r.order_line_id=l.id) persisted_requirement_count,
    (SELECT count(*)::int FROM v2_artwork_assignments a WHERE a.organization_id=l.organization_id AND a.order_line_id=l.id) artwork_assignment_count,
    (SELECT count(*)::int FROM v2_prepress_units u WHERE u.organization_id=l.organization_id AND u.order_line_id=l.id) prepress_unit_count,
    (SELECT count(*)::int FROM v2_production_works w WHERE w.organization_id=l.organization_id AND w.order_line_id=l.id) production_work_count,
    (SELECT count(*)::int FROM v2_audit_events a WHERE a.organization_id=l.organization_id AND a.resource_id IN (l.id,d.id)) audit_event_count
    FROM v2_sales_documents d JOIN v2_sales_order_details o ON o.organization_id=d.organization_id AND o.document_id=d.id AND o.commercial_state='open' AND o.archived_at IS NULL
    JOIN v2_sales_document_lines l ON l.organization_id=d.organization_id AND l.document_id=d.id
    JOIN v2_route_instances ri ON ri.organization_id=l.organization_id AND ri.order_document_id=d.id AND ri.order_line_id=l.id
    LEFT JOIN v2_route_instance_steps step ON step.organization_id=ri.organization_id AND step.route_instance_id=ri.id AND step.id=ri.current_step_id
    LEFT JOIN customers c ON c.organization_id=d.organization_id AND c.id=d.customer_id
    WHERE ($1::text IS NULL OR d.organization_id=$1) AND d.document_kind='order' AND ri.route_state IN ('pending','active')
      AND EXISTS(SELECT 1 FROM v2_route_instance_steps ps WHERE ps.organization_id=ri.organization_id AND ps.route_instance_id=ri.id AND ps.step_kind='prepress')
    ORDER BY d.organization_id,d.display_number,l.position,l.id`))
    .map(row => classify(row, historicalDataDisposition("prepress", row),
      row.production_requirement_state === "unconfigured" ? "Separate into Needs configuration/recovery; retain record and audit evidence. Recover only with authoritative requirements, never infer them from artwork." : "Configured work remains in the normal operator queue."));

  const payments = (await query(`SELECT p.organization_id,p.id payment_id,p.invoice_id,p.source,p.method,p.recorded_at,
    p.provider_operation_id IS NOT NULL has_provider_operation,p.provider_transaction_id IS NOT NULL has_provider_transaction,
    p.stripe_account_id IS NOT NULL has_stripe_account,
    COALESCE(c.display_name,c.company_name,'') ~* '${markerSql}' customer_has_qa_marker,
    (SELECT count(*)::int FROM v2_billing_payment_allocations a WHERE a.organization_id=p.organization_id AND a.payment_id=p.id) allocation_count,
    (SELECT count(*)::int FROM v2_billing_refund_allocations r WHERE r.organization_id=p.organization_id AND r.payment_id=p.id) refund_allocation_count,
    (SELECT count(*)::int FROM v2_quickbooks_payment_references r WHERE r.organization_id=p.organization_id AND r.payment_id=p.id) quickbooks_reference_count
    FROM v2_billing_payments p LEFT JOIN v2_billing_invoices i ON i.organization_id=p.organization_id AND i.id=p.invoice_id
    LEFT JOIN customers c ON c.organization_id=i.organization_id AND c.id=i.customer_id
    WHERE ($1::text IS NULL OR p.organization_id=$1) ORDER BY p.organization_id,p.recorded_at,p.id`))
    .map(row => classify(row, historicalDataDisposition("payment", row), "Payment, allocation, provider and accounting evidence must be retained, including QA-marked payments."));

  const queues: Row[] = [];
  // Identifiers below are a fixed code-owned allowlist; CLI input is only a bind parameter.
  for (const [table, state, providerEvidence] of [
    ["v2_invoice_email_delivery_jobs", "state", "provider_attempted_at IS NOT NULL OR provider_message_id IS NOT NULL"],
    ["v2_proof_delivery_jobs", "state", "provider_attempted_at IS NOT NULL OR provider_message_id IS NOT NULL"],
    ["v2_quickbooks_sync_jobs", "state", "NULL::boolean"],
    ["v2_outbox_messages", "status", "NULL::boolean"],
  ]) {
    const rows = await query(`SELECT organization_id,id job_id,'${table}' queue,${state} state,attempt_count,created_at,available_at,completed_at,
      lease_expires_at IS NOT NULL AND lease_expires_at < now() lease_expired,
      available_at < now()-interval '7 days' available_over_7_days_ago,${providerEvidence} has_provider_attempt_evidence,${table === "v2_outbox_messages" ? "event_type" : "NULL::text"} event_type
      FROM ${table} WHERE ($1::text IS NULL OR organization_id=$1) ORDER BY organization_id,created_at,id`);
    queues.push(...rows.map(row => classify(row, historicalDataDisposition("queue", row),
      "Retain delivery/idempotency/reconciliation evidence; age alone never authorizes retry, deletion, or provider writes.")));
  }

  const duplicateCustomers = (await query(`WITH candidates AS (
    SELECT c.organization_id,c.id,lower(trim(COALESCE(NULLIF(c.display_name,''),c.company_name))) match_key,
      COALESCE(c.display_name,c.company_name,'') ~* '${markerSql}' has_qa_marker,
      (SELECT count(*)::int FROM v2_sales_documents d WHERE d.organization_id=c.organization_id AND d.customer_id=c.id) document_count
    FROM customers c WHERE ($1::text IS NULL OR c.organization_id=$1) AND c.merged_into_customer_id IS NULL
  ) SELECT organization_id,array_agg(id ORDER BY id) customer_ids,count(*)::int customer_count,
    bool_and(has_qa_marker) all_have_qa_marker,sum(document_count)::int linked_document_count
    FROM candidates WHERE match_key<>'' GROUP BY organization_id,match_key HAVING count(*)>1 ORDER BY organization_id,min(id)`))
    .map(row => classify(row, "REVIEW", "Exact normalized display-name collision only; identity/relationship review and canonical CRM merge are required. No PII is emitted."));

  const orphanLike = (await query(`SELECT f.organization_id,f.id artwork_file_id,f.source_kind,f.created_at,
    f.created_at < now()-interval '30 days' older_than_30_days,
    EXISTS(SELECT 1 FROM v2_artwork_storage_upload_intents i WHERE i.organization_id=f.organization_id AND i.adopted_artwork_file_id=f.id) has_upload_intent
    FROM v2_artwork_files f WHERE ($1::text IS NULL OR f.organization_id=$1)
      AND NOT EXISTS(SELECT 1 FROM v2_artwork_assignments a WHERE a.organization_id=f.organization_id AND a.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_quote_artwork_assignments a WHERE a.organization_id=f.organization_id AND a.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_quote_accepted_artwork_snapshots s WHERE s.organization_id=f.organization_id AND s.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_proof_version_artwork p WHERE p.organization_id=f.organization_id AND p.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_prepress_units p WHERE p.organization_id=f.organization_id AND p.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_production_works p WHERE p.organization_id=f.organization_id AND p.artwork_file_id=f.id)
      AND NOT EXISTS(SELECT 1 FROM v2_artwork_files child WHERE child.organization_id=f.organization_id AND child.derived_from_artwork_file_id=f.id)
    ORDER BY f.organization_id,f.created_at,f.id`))
    .map(row => classify(row, "REVIEW", "No direct references found in listed owners; pending uploads or immutable JSON evidence may still reference the file. No storage deletion attempted."));

  const uploadIntents = (await query(`SELECT organization_id,id upload_intent_id,state,cleanup_attempts,last_error_code,created_at,updated_at,
    adopted_artwork_file_id IS NOT NULL has_adopted_file,object_created_by_intent,
    reconciliation_lease_expires_at IS NOT NULL AND reconciliation_lease_expires_at < now() lease_expired
    FROM v2_artwork_storage_upload_intents WHERE ($1::text IS NULL OR organization_id=$1) ORDER BY organization_id,created_at,id`))
    .map(row => classify(row, row.state === "adopted" || row.state === "cleaned" ? "KEEP AS HISTORY" : "REVIEW", "Canonical storage reconciler owns cleanup; this inventory never invokes storage or changes intent state."));

  const failedOperations = (await query(`SELECT organization_id,id operation_request_id,operation,status,created_at,updated_at,
    result_resource_type,result_resource_id,
    business_request_id ~* '${markerSql}' request_has_qa_marker
    FROM v2_operation_requests WHERE ($1::text IS NULL OR organization_id=$1)
      AND (status <> 'succeeded' OR business_request_id ~* 'migration|replaced')
    ORDER BY organization_id,created_at,id`))
    .map(row => classify(row, "REVIEW", "Failed/incomplete/replacement-marker operation is audit evidence, not proof of failed migration or permission to delete."));

  const transitionalFields = await query(`SELECT p.organization_id,
    count(*)::int product_count,
    count(*) FILTER (WHERE p.option_tree_json IS NOT NULL)::int legacy_option_tree_nonnull,
    count(*) FILTER (WHERE p.options_json IS NOT NULL)::int legacy_options_nonnull,
    count(*) FILTER (WHERE p.pricing_formula IS NOT NULL AND p.pricing_formula<>'')::int legacy_formula_nonempty,
    count(*) FILTER (WHERE p.pricing_formula_id IS NOT NULL)::int legacy_formula_binding_nonnull,
    count(*) FILTER (WHERE p.pbv2_active_tree_version_id IS NOT NULL)::int active_version_pointer_nonnull,
    (SELECT count(*)::int FROM v2_sales_document_lines l WHERE l.organization_id=p.organization_id AND l.production_requirement_state='unconfigured') unconfigured_sales_lines,
    (SELECT count(*)::int FROM v2_product_recipe_components c WHERE c.organization_id=p.organization_id AND c.replaces_pbv2_compatibility) explicit_pbv2_recipe_replacements
    FROM products p WHERE ($1::text IS NULL OR p.organization_id=$1) GROUP BY p.organization_id ORDER BY p.organization_id`);

  // Inventory exact V2 table occupancy (empty does not mean unused). Non-tenant tables are
  // reported only for explicit all-organization scope, never leaked into a tenant report.
  const tables = (await client.query<{table_name:string;tenant_scoped:boolean}>(`SELECT t.table_name,
    EXISTS(SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.table_name AND c.column_name='organization_id') tenant_scoped
    FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_type='BASE TABLE' AND t.table_name LIKE 'v2\\_%' ESCAPE '\\'
    ORDER BY t.table_name`)).rows;
  const tableOccupancy: Row[] = [];
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table.table_name)) throw new Error("Unexpected V2 table identifier.");
    if (organizationId && !table.tenant_scoped) continue;
    const result = table.tenant_scoped
      ? await query(`SELECT count(*)::int row_count FROM "${table.table_name}" WHERE ($1::text IS NULL OR organization_id=$1)`)
      : (await client.query<Row>(`SELECT count(*)::int row_count FROM "${table.table_name}"`)).rows;
    tableOccupancy.push({ table: table.table_name, tenant_scoped: table.tenant_scoped, row_count: result[0].row_count, disposition: "KEEP", reason: "Occupancy is not reachability proof; schema removal needs code/constraints/recovery analysis." });
  }
  return {
    summary: {
      organizationCount: organizations.length,
      knownRehearsalOrganizations: organizations.filter(isFixture).length,
      salesDocumentsByKind: counts(salesDocuments, "document_kind"),
      productVersionsByStatus: counts(productVersions, "status"),
      prepressByRequirementState: counts(prepress, "production_requirement_state"),
      paymentCount: payments.length,queuesByState: counts(queues, "state"),
      duplicateCustomerGroups: duplicateCustomers.length,orphanLikeArtworkFiles: orphanLike.length,
      uploadIntentsByState: counts(uploadIntents, "state"),reviewOperationCount: failedOperations.length,
      safeToDeleteCount: 0,
    },
    organizations: organizations.map(row => ({ ...row, provenance: isFixture(row) ? "known_rehearsal_organization_id" : row.sandbox_name_marker ? "sandbox_name_signal_only" : "unproven", disposition: isFixture(row) ? "KEEP AS HISTORY" : "REVIEW" })),
    salesDocuments,productVersions,prepress,payments,queues,duplicateCustomers,orphanLike,uploadIntents,failedOperations,transitionalFields,tableOccupancy,
  };
}

async function main(): Promise<void> {
  const organizationId = historicalDataScope(process.argv.slice(2));
  const { transaction, data } = await readOnlyDevSnapshot(process.env, client => inventory(client, organizationId));
  process.stdout.write(`${JSON.stringify({ reportVersion: 1, target: "PrintersHero-DEV / Development", scope: organizationId ?? "all-organizations", transaction, dryRun: true, databaseMutations: 0, providerCalls: 0, ...data }, null, 2)}\n`);
}
void main().catch(error => {
  // Database error messages can contain customer/provider values; emit only safe diagnostics.
  const code = error && typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : undefined;
  const safeConfigurationMessage = error instanceof Error && (error.name === "V2ConfigurationError" || error.message.startsWith("Provide exactly") || error.message.startsWith("Requested organization")) ? error.message : "Read-only inventory failed; no report emitted. Inspect schema/connectivity without logging credentials.";
  process.stderr.write(`${JSON.stringify({ error: "dev_hygiene_inventory_failed", code, message: safeConfigurationMessage })}\n`);
  process.exitCode = 1;
});
