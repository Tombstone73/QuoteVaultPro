import type { TransactionalClient } from "../persistence/types.js";

export type CommercialPhysicalPostcondition = Readonly<{ id: string; passed: boolean; detail: string }>;

const tables = ["v2_sales_document_number_counters", "v2_sales_documents", "v2_sales_quote_details", "v2_sales_order_details", "v2_sales_document_lines", "v2_sales_quote_checkpoints", "v2_sales_quote_conversions", "v2_sales_quote_delivery_attempts"] as const;
const constraints = [
  "v2_sales_document_number_counters_kind_chk", "v2_sales_document_number_counters_next_number_chk",
  "v2_sales_documents_kind_chk", "v2_sales_documents_business_number_chk", "v2_sales_documents_display_number_chk", "v2_sales_documents_currency_chk", "v2_sales_documents_terms_object_chk", "v2_sales_documents_revision_chk", "v2_sales_documents_customer_or_contact_chk", "v2_sales_documents_terms_no_duplicate_projection_chk",
  "v2_sales_document_lines_quantity_chk", "v2_sales_document_lines_currency_chk", "v2_sales_document_lines_resolved_configuration_object_chk",
  "v2_sales_document_lines_pricing_result_object_chk", "v2_sales_document_lines_selling_decision_object_chk",
  "v2_sales_quote_details_kind_chk", "v2_sales_quote_details_delivery_state_chk", "v2_sales_quote_details_acceptance_state_chk", "v2_sales_order_details_kind_chk", "v2_sales_order_details_commercial_state_chk", "v2_sales_order_details_cancellation_chk", "v2_sales_order_details_archive_chk",
  "v2_sales_quote_checkpoints_kind_chk", "v2_sales_quote_checkpoints_payload_object_chk",
  "v2_sales_quote_delivery_prepared_evidence_chk",
] as const;
const indexes = [
  "v2_sales_documents_org_kind_number_uidx", "v2_sales_documents_org_kind_display_number_uidx", "v2_sales_document_lines_org_document_position_uidx",
  "v2_sales_quote_checkpoints_org_quote_sequence_uidx", "v2_sales_quote_checkpoints_one_acceptance_uidx", "v2_sales_quote_checkpoints_one_conversion_uidx",
  "v2_sales_quote_conversions_org_quote_uidx", "v2_sales_quote_conversions_org_order_uidx", "v2_sales_quote_conversions_org_source_checkpoint_uidx", "v2_sales_quote_conversions_org_conversion_checkpoint_uidx", "v2_sales_quote_conversions_org_operation_request_uidx",
  "v2_sales_order_details_org_state_archive_idx",
] as const;
const foreignKeyConstraints = [
  "v2_sales_documents_customer_tenant_fk", "v2_sales_documents_contact_tenant_fk", "v2_sales_quote_details_document_fk", "v2_sales_order_details_document_fk",
  "v2_sales_document_lines_document_tenant_fk", "v2_sales_document_lines_product_tenant_fk", "v2_sales_quote_checkpoints_quote_tenant_fk", "v2_sales_quote_checkpoints_request_tenant_fk", "v2_sales_quote_checkpoints_source_tenant_fk",
  "v2_sales_quote_conversions_quote_tenant_fk", "v2_sales_quote_conversions_order_tenant_fk", "v2_sales_quote_conversions_source_checkpoint_tenant_fk", "v2_sales_quote_conversions_conversion_checkpoint_tenant_fk", "v2_sales_quote_conversions_request_tenant_fk",
] as const;

export async function checkV2CommercialPhysicalPostconditions(client: TransactionalClient): Promise<CommercialPhysicalPostcondition[]> {
  const [foundTables, foundConstraints, foundIndexes, foundTriggers, columns] = await Promise.all([
    client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [tables]),
    client.query<{ conname: string; table_name: string; convalidated: boolean }>("SELECT conname,conrelid::regclass::text table_name,convalidated FROM pg_constraint WHERE conname = ANY($1::text[])", [[...constraints, ...foreignKeyConstraints]]),
    client.query<{ indexname: string; indexdef: string }>("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND indexname = ANY($1::text[])", [indexes]),
    client.query<{ tgname: string; table_name: string; tgenabled: string }>("SELECT tgname,tgrelid::regclass::text table_name,tgenabled FROM pg_trigger WHERE tgname IN ('v2_sales_quote_checkpoint_immutable','v2_sales_quote_conversion_validate','v2_sales_document_customer_contact_validate','v2_sales_document_subtype_validate','v2_sales_converted_checkpoint_relation_validate','v2_sales_quote_conversion_immutable','v2_sales_quote_detail_retained_validate','v2_sales_order_detail_retained_validate','v2_sales_quote_delivery_prepared_evidence_immutable') AND NOT tgisinternal"),
    client.query<{ table_name: string; column_name: string; data_type: string }>("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND (table_name,column_name) IN (('v2_sales_documents','business_number'),('v2_sales_document_lines','calculated_line_cents'),('v2_sales_document_lines','selling_line_cents'),('v2_sales_quote_checkpoints','payload'),('v2_sales_quote_delivery_attempts','prepared_evidence_json'))"),
  ]);
  const tableSet = new Set(foundTables.rows.map((row) => row.table_name));
  const constraintSet = new Set(foundConstraints.rows.map((row) => row.conname));
  const indexMap = new Map(foundIndexes.rows.map((row) => [row.indexname, row.indexdef]));
  const triggerSet = new Set(foundTriggers.rows.map((row) => row.tgname));
  const columnMap = new Map(columns.rows.map((row) => [`${row.table_name}.${row.column_name}`, row.data_type]));
  return [
    ...tables.map((id) => ({ id: `table:${id}`, passed: tableSet.has(id), detail: "required additive Sales persistence table" })),
    ...constraints.map((id) => ({ id: `constraint:${id}`, passed: constraintSet.has(id), detail: "required commercial integrity constraint" })),
    ...foreignKeyConstraints.map((id) => ({ id: `foreign-key:${id}`, passed: constraintSet.has(id), detail: "required tenant-scoped commercial foreign key" })),
    ...indexes.map((id) => ({ id: `index:${id}`, passed: indexMap.has(id), detail: "required tenant-scoped commercial index" })),
    ...["v2_sales_documents_org_kind_number_uidx", "v2_sales_documents_org_kind_display_number_uidx", "v2_sales_document_lines_org_document_position_uidx", "v2_sales_quote_checkpoints_org_quote_sequence_uidx", "v2_sales_quote_conversions_org_quote_uidx", "v2_sales_quote_conversions_org_order_uidx"].map((id) => ({ id: `unique-index:${id}`, passed: /\bUNIQUE\b/i.test(indexMap.get(id) ?? ""), detail: "required uniqueness protection" })),
    { id: "trigger:v2_sales_quote_checkpoint_immutable", passed: triggerSet.has("v2_sales_quote_checkpoint_immutable"), detail: "checkpoint rows are append-only" },
    { id: "trigger:v2_sales_quote_conversion_validate", passed: triggerSet.has("v2_sales_quote_conversion_validate"), detail: "conversion endpoints are type-validated" },
    { id: "trigger:v2_sales_document_customer_contact_validate", passed: triggerSet.has("v2_sales_document_customer_contact_validate"), detail: "customer/contact association is validated" },
    { id: "trigger:v2_sales_document_subtype_validate", passed: triggerSet.has("v2_sales_document_subtype_validate"), detail: "every Sales header has its typed lifecycle" },
    { id: "trigger:v2_sales_converted_checkpoint_relation_validate", passed: triggerSet.has("v2_sales_converted_checkpoint_relation_validate"), detail: "converted checkpoint has canonical conversion" },
    { id: "trigger:v2_sales_quote_conversion_immutable", passed: triggerSet.has("v2_sales_quote_conversion_immutable"), detail: "conversion lineage is append-only" },
    { id: "trigger:v2_sales_quote_detail_retained_validate", passed: triggerSet.has("v2_sales_quote_detail_retained_validate"), detail: "Quote header cannot be orphaned" },
    { id: "trigger:v2_sales_order_detail_retained_validate", passed: triggerSet.has("v2_sales_order_detail_retained_validate"), detail: "Order header cannot be orphaned" },
    { id: "column:v2_sales_documents.business_number", passed: columnMap.get("v2_sales_documents.business_number") === "bigint", detail: "business number is an integer" },
    { id: "column:v2_sales_document_lines.calculated_line_cents", passed: columnMap.get("v2_sales_document_lines.calculated_line_cents") === "bigint", detail: "calculated money is integer cents" },
    { id: "column:v2_sales_document_lines.selling_line_cents", passed: columnMap.get("v2_sales_document_lines.selling_line_cents") === "bigint", detail: "selling money is integer cents" },
    { id: "column:v2_sales_quote_checkpoints.payload", passed: columnMap.get("v2_sales_quote_checkpoints.payload") === "jsonb", detail: "checkpoint payload is structured JSON" },
    { id: "column:v2_sales_quote_delivery_attempts.prepared_evidence_json", passed: columnMap.get("v2_sales_quote_delivery_attempts.prepared_evidence_json") === "jsonb", detail: "prepared delivery evidence is structured JSON" },
    { id: "validated:quote-delivery-prepared-evidence", passed: foundConstraints.rows.some(row => row.conname === "v2_sales_quote_delivery_prepared_evidence_chk" && row.table_name === "v2_sales_quote_delivery_attempts" && row.convalidated), detail: "prepared evidence is validated against its attempt identity" },
    { id: "trigger:v2_sales_quote_delivery_prepared_evidence_immutable", passed: foundTriggers.rows.some(row => row.tgname === "v2_sales_quote_delivery_prepared_evidence_immutable" && row.table_name === "v2_sales_quote_delivery_attempts" && (row.tgenabled === "O" || row.tgenabled === "A")), detail: "new delivery evidence is required and existing evidence cannot be rewritten" },
  ];
}

export function assertV2CommercialPhysicalPostconditions(findings: readonly CommercialPhysicalPostcondition[]): void {
  const failed = findings.filter((finding) => !finding.passed);
  if (failed.length) throw new Error(`V2 commercial physical postconditions failed: ${failed.map((finding) => finding.id).join(", ")}`);
}

/** Narrow deployment gate for the schema needed before Quote delivery can run. */
export async function assertPreparedQuoteDeliverySchema(client: TransactionalClient): Promise<void> {
  const result = await client.query<{ ready: boolean }>(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='v2_sales_quote_delivery_attempts' AND column_name='prepared_evidence_json'
      AND data_type='jsonb' AND is_nullable='YES')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass('public.v2_sales_quote_delivery_attempts')
      AND conname='v2_sales_quote_delivery_prepared_evidence_chk' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.v2_sales_quote_delivery_attempts')
      AND tgname='v2_sales_quote_delivery_prepared_evidence_immutable' AND NOT tgisinternal AND tgenabled IN ('O','A')) AS ready`);
  if (result.rows[0]?.ready !== true) throw new Error("Prepared Quote delivery schema is unavailable.");
}
