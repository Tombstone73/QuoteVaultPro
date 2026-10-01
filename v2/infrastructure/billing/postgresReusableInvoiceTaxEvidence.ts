import { readReusableInvoiceTaxEvidence, type InvoiceTaxEvidenceIdentity, type InvoiceTaxEvidenceSource } from "../../src/modules/billing/reusableInvoiceTaxEvidence.js";
import type { TransactionalClient } from "../persistence/types.js";

/** One statement binds the current Invoice, lines and immutable checkpoint. Callers
 * that mutate already hold their existing Invoice lock on this same client. */
export async function readReusableInvoiceTaxEvidenceInTransaction(client: TransactionalClient, identity: InvoiceTaxEvidenceIdentity) {
  const result = await client.query<InvoiceTaxEvidenceSource>(`SELECT
    i.organization_id AS "organizationId",i.id AS "invoiceId",i.sales_order_document_id AS "orderId",
    i.invoice_state AS "invoiceState",i.synchronization_version::text AS "financialVersion",i.currency,
    i.invoice_display_number AS "invoiceNumber",i.tax_evidence AS "rawEvidence",i.tax_calculator_version AS "calculatorVersion",
    i.tax_context_reference AS "contextReference",i.sales_tax_composition AS "salesTaxComposition",
    i.sales_commercial_charge AS "commercialCharge",i.subtotal_cents::text AS "subtotalCents",
    i.tax_total_cents::text AS "taxTotalCents",i.total_cents::text AS "totalCents",i.sales_adjustment_cents::text AS "adjustmentCents",
    EXISTS(SELECT 1 FROM v2_billing_invoice_additional_charges c WHERE c.organization_id=i.organization_id AND c.invoice_id=i.id) AS "hasAdditionalCharges",
    (SELECT jsonb_agg(jsonb_build_object('lineId',l.source_sales_line_id,'currency',l.currency,'cents',l.selling_line_cents::text) ORDER BY l.position)
      FROM v2_billing_invoice_lines l WHERE l.organization_id=i.organization_id AND l.invoice_id=i.id AND l.sales_order_document_id=i.sales_order_document_id) AS lines,
    (SELECT c.checkpoint_json FROM v2_billing_invoice_checkpoints c WHERE c.organization_id=i.organization_id AND c.invoice_id=i.id) AS "issuedCheckpoint"
    FROM v2_billing_invoices i WHERE i.organization_id=$1 AND i.id=$2 AND i.sales_order_document_id=$3`,
  [identity.organizationId, identity.invoiceId, identity.orderId]);
  return readReusableInvoiceTaxEvidence(result.rows[0] ?? {} as InvoiceTaxEvidenceSource, identity);
}
