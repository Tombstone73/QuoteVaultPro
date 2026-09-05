/**
 * R0265 is intentionally a catalog-only recovery stage.  It restores the
 * missing V2 Sales and platform Audit relations without inventing a V2 view
 * of V1 commercial history.  A caller must run this only after R0264 proves
 * the M0180--M0184 production-compatible baseline and before Drizzle M0200+.
 *
 * This module describes work; it has no database, filesystem, runtime, or
 * provider side effects.  The executor is responsible for loading the named
 * immutable source files, executing the statements in one transaction, and
 * recording/attesting the postconditions.
 */
import type { ReconciliationStageDefinition } from "./types.js";

export const r0265SalesAudit: ReconciliationStageDefinition = {
  id: "R0265",
  label: "Sales and audit physical foundation",
  migrationFiles: [
    "0187_v2_sales_commercial_persistence.sql",
    "0188_v2_sales_customer_contact_reference_integrity.sql",
    "0189_v2_sales_document_and_conversion_integrity.sql",
    "0190_v2_sales_terms_single_owner.sql",
    "0191_v2_sales_subtype_and_terms_hardening.sql",
  ],
  postconditions: [
    { kind: "table", name: "sales-number-counters", table: "v2_sales_document_number_counters", description: "Tenant-scoped quote/order number counters exist." },
    { kind: "table", name: "sales-documents", table: "v2_sales_documents", description: "Canonical V2 Sales headers exist." },
    { kind: "table", name: "sales-quote-details", table: "v2_sales_quote_details", description: "Typed Quote lifecycle relation exists." },
    { kind: "table", name: "sales-order-details", table: "v2_sales_order_details", description: "Typed Order lifecycle relation exists." },
    { kind: "table", name: "sales-document-lines", table: "v2_sales_document_lines", description: "Evidence-backed Sales lines relation exists." },
    { kind: "table", name: "sales-quote-checkpoints", table: "v2_sales_quote_checkpoints", description: "Immutable Quote checkpoint relation exists." },
    { kind: "table", name: "sales-quote-conversions", table: "v2_sales_quote_conversions", description: "Canonical Quote-to-Order conversion relation exists." },
    { kind: "table", name: "audit-events", table: "v2_audit_events", description: "Platform semantic audit relation exists." },
    { kind: "constraint", name: "sales-document-customer-tenant", table: "v2_sales_documents", expected: "v2_sales_documents_customer_tenant_fk", description: "Customer references remain tenant-scoped." },
    { kind: "constraint", name: "sales-document-contact-tenant", table: "v2_sales_documents", expected: "v2_sales_documents_contact_tenant_fk", description: "Contact references remain tenant-scoped." },
    { kind: "constraint", name: "sales-terms-single-owner", table: "v2_sales_documents", expected: "v2_sales_documents_terms_no_duplicate_projection_chk", description: "Terms JSON cannot duplicate mutable Sales fields." },
    { kind: "constraint", name: "sales-line-document-tenant", table: "v2_sales_document_lines", expected: "v2_sales_document_lines_document_tenant_fk", description: "Sales line references remain tenant-scoped." },
    { kind: "constraint", name: "quote-conversion-tenant", table: "v2_sales_quote_conversions", expected: "v2_sales_quote_conversions_quote_tenant_fk", description: "Conversion lineage remains tenant-scoped." },
    { kind: "constraint", name: "audit-request-tenant", table: "v2_audit_events", expected: "v2_audit_events_request_tenant_fk", description: "Audit request references remain tenant-scoped." },
    { kind: "index", name: "sales-document-business-number", table: "v2_sales_documents", expected: "v2_sales_documents_org_kind_number_uidx", description: "Sales business numbers are unique per tenant and kind." },
    { kind: "index", name: "sales-document-display-number", table: "v2_sales_documents", expected: "v2_sales_documents_org_kind_display_number_uidx", description: "Sales display numbers are unique per tenant and kind." },
    { kind: "index", name: "sales-line-position", table: "v2_sales_document_lines", expected: "v2_sales_document_lines_org_document_position_uidx", description: "Sales line positions are retry-safe." },
    { kind: "index", name: "quote-checkpoint-sequence", table: "v2_sales_quote_checkpoints", expected: "v2_sales_quote_checkpoints_org_quote_sequence_uidx", description: "Quote checkpoint sequences are durable." },
    { kind: "index", name: "quote-conversion-identity", table: "v2_sales_quote_conversions", expected: "v2_sales_quote_conversions_org_quote_uidx", description: "A Quote has one canonical conversion." },
    { kind: "index", name: "audit-resource-ordering", table: "v2_audit_events", expected: "v2_audit_events_org_resource_created_idx", description: "Audit resource lookup ordering exists." },
    { kind: "trigger", name: "quote-checkpoint-immutable", table: "v2_sales_quote_checkpoints", expected: "v2_sales_quote_checkpoint_immutable", description: "Quote checkpoints are append-only." },
    { kind: "trigger", name: "quote-conversion-validation", table: "v2_sales_quote_conversions", expected: "v2_sales_quote_conversion_validate", description: "Conversion endpoints are type-validated." },
    { kind: "trigger", name: "sales-customer-contact-validation", table: "v2_sales_documents", expected: "v2_sales_document_customer_contact_validate", description: "Customer/contact relationships are validated at the Sales boundary." },
    { kind: "trigger", name: "sales-subtype-validation", table: "v2_sales_documents", expected: "v2_sales_document_subtype_validate", description: "Every Sales header retains its typed lifecycle." },
    { kind: "query", name: "no-automatic-v1-sales-import", query: "SELECT NOT EXISTS (SELECT 1 FROM v2_sales_documents) AND NOT EXISTS (SELECT 1 FROM v2_sales_document_lines) AND NOT EXISTS (SELECT 1 FROM v2_sales_quote_checkpoints) AND NOT EXISTS (SELECT 1 FROM v2_sales_quote_conversions) AND NOT EXISTS (SELECT 1 FROM v2_audit_events)", description: "R0265 creates no inferred V2 Sales or audit facts from legacy rows." },
  ],
  legacyDataPolicy: "DDL only; the executor isolates M0192 audit DDL and reserves all authority seeding for R0268. Do not copy V1 quote/order/audit rows: they lack evidence-complete pricing, immutable checkpoint, and conversion lineage. Never infer status, customer/contact relationship, price, financial state, timestamp, or provider state.",
};
